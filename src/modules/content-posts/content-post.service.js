const { AppError } = require('../../common/errors/AppError');
const { ContentPost } = require('./content-post.model');
const { Business } = require('../businesses/business.model');
const { Product } = require('../products/product.model');
const { Service } = require('../services/service.model');
const { sanitizeCatalogueMedia } = require('../media/catalogue-media.service');
const { ContentPostLike } = require('./content-post-like.model');
const { Follow } = require('../follows/follow.model');
const { Favorite } = require('../favorites/favorite.model');
const contentPostSaveService = require('./content-post-save.service');

function publicRelations(query) {
  return query
    .populate({ path: 'businessId', select: 'name slug' })
    .populate({ path: 'linkedProductId', match: { status: 'active', moderationStatus: 'approved' }, select: 'name slug basePriceMinor currency media' })
    .populate({ path: 'linkedServiceId', match: { status: 'active', moderationStatus: 'approved' }, select: 'name slug basePriceMinor currency media' })
    .populate({ path: 'taggedProductIds', match: { status: 'active', moderationStatus: 'approved' }, select: 'name slug basePriceMinor currency media' })
    .populate({ path: 'taggedServiceIds', match: { status: 'active', moderationStatus: 'approved' }, select: 'name slug basePriceMinor currency media' });
}

async function viewerLikeIds(posts, viewerId) {
  if (!viewerId || !posts.length) return new Set();
  const likes = await ContentPostLike.find({ userId: viewerId, postId: { $in: posts.map((post) => post._id) } }).select('postId').lean();
  return new Set(likes.map((like) => like.postId.toString()));
}

async function publicPostJSON(posts, viewerId) {
  const [likedIds, savedIds] = await Promise.all([viewerLikeIds(posts, viewerId), contentPostSaveService.viewerSaveIds(posts, viewerId)]);
  return posts.map((post) => post.toPublicJSON({ likedByViewer: likedIds.has(post._id.toString()), savedByViewer: savedIds.has(post._id.toString()) }));
}

function normalizeLinks(input) {
  return {
    linkedProductId: input.linkedProductId || null,
    linkedServiceId: input.linkedServiceId || null
  };
}

function normalizeHashtags(values = []) {
  return [...new Set(values.map((value) => String(value).trim().replace(/^#+/, '').toLowerCase()).filter(Boolean).map((value) => `#${value}`))].slice(0, 10);
}

function normalizeIds(values = []) {
  return [...new Set(values.map((value) => value.toString()))];
}

function assertPostHasContent(body, media) {
  if (!String(body || '').trim() && !(media || []).length) {
    throw new AppError(400, 'CONTENT_POST_EMPTY', 'Add text, a photo, or a video before saving this post');
  }
}

async function validateLinks(businessId, input) {
  const links = normalizeLinks(input);
  if (links.linkedProductId) {
    const product = await Product.exists({ _id: links.linkedProductId, businessId });
    if (!product) throw new AppError(400, 'LINKED_PRODUCT_NOT_FOUND', 'The linked product does not belong to this business');
  }
  if (links.linkedServiceId) {
    const service = await Service.exists({ _id: links.linkedServiceId, businessId });
    if (!service) throw new AppError(400, 'LINKED_SERVICE_NOT_FOUND', 'The linked service does not belong to this business');
  }
  return links;
}

async function validateTags(businessId, input) {
  const taggedProductIds = normalizeIds(input.taggedProductIds || []);
  const taggedServiceIds = normalizeIds(input.taggedServiceIds || []);
  const [productCount, serviceCount] = await Promise.all([
    taggedProductIds.length ? Product.countDocuments({ _id: { $in: taggedProductIds }, businessId }) : 0,
    taggedServiceIds.length ? Service.countDocuments({ _id: { $in: taggedServiceIds }, businessId }) : 0
  ]);
  if (productCount !== taggedProductIds.length) throw new AppError(400, 'TAGGED_PRODUCT_NOT_FOUND', 'Every tagged product must belong to this business');
  if (serviceCount !== taggedServiceIds.length) throw new AppError(400, 'TAGGED_SERVICE_NOT_FOUND', 'Every tagged service must belong to this business');
  return { taggedProductIds, taggedServiceIds };
}

async function createPost(business, input, authorId) {
  const links = await validateLinks(business._id, input);
  const tags = await validateTags(business._id, input);
  const media = await sanitizeCatalogueMedia({ businessId: business._id, actorId: authorId, media: input.media || [], field: 'Post media', allowVideo: true });
  assertPostHasContent(input.body, media);
  return ContentPost.create({ businessId: business._id, authorId, type: input.type, title: input.title || '', body: input.body, media, hashtags: normalizeHashtags(input.hashtags), ...tags, ...links });
}

async function updatePost(businessId, postId, input, actorId) {
  const post = await ContentPost.findOne({ _id: postId, businessId });
  if (!post) throw new AppError(404, 'CONTENT_POST_NOT_FOUND', 'Content post not found');
  const mergedLinks = {
    linkedProductId: input.linkedProductId !== undefined ? input.linkedProductId : post.linkedProductId,
    linkedServiceId: input.linkedServiceId !== undefined ? input.linkedServiceId : post.linkedServiceId
  };
  const links = await validateLinks(businessId, mergedLinks);
  const tags = await validateTags(businessId, { taggedProductIds: input.taggedProductIds !== undefined ? input.taggedProductIds : post.taggedProductIds, taggedServiceIds: input.taggedServiceIds !== undefined ? input.taggedServiceIds : post.taggedServiceIds });
  const nextBody = input.body !== undefined ? input.body : post.body;
  const nextMedia = input.media !== undefined
    ? await sanitizeCatalogueMedia({ businessId, actorId, media: input.media, field: 'Post media', allowVideo: true })
    : post.media;
  assertPostHasContent(nextBody, nextMedia);
  for (const field of ['type', 'title', 'body']) if (input[field] !== undefined) post[field] = input[field];
  if (input.hashtags !== undefined) post.hashtags = normalizeHashtags(input.hashtags);
  post.taggedProductIds = tags.taggedProductIds;
  post.taggedServiceIds = tags.taggedServiceIds;
  if (input.media !== undefined) post.media = nextMedia;
  post.linkedProductId = links.linkedProductId;
  post.linkedServiceId = links.linkedServiceId;
  if (['active', 'rejected'].includes(post.status)) {
    post.status = 'draft';
    post.moderationStatus = 'pending';
    post.publishedAt = null;
    post.rejectionReason = null;
  }
  await post.save();
  return post;
}

async function submitPost(businessId, postId) {
  const [business, post] = await Promise.all([Business.findById(businessId), ContentPost.findOne({ _id: postId, businessId })]);
  if (!post) throw new AppError(404, 'CONTENT_POST_NOT_FOUND', 'Content post not found');
  if (!business || business.status !== 'active' || business.moderationStatus !== 'approved') throw new AppError(409, 'BUSINESS_NOT_READY_FOR_CONTENT', 'The business must be active and approved before content can be published');
  if (!['draft', 'rejected'].includes(post.status)) throw new AppError(409, 'CONTENT_POST_SUBMIT_NOT_AVAILABLE', 'This content post cannot be submitted in its current state');
  post.status = 'pending_review';
  post.moderationStatus = 'pending';
  post.rejectionReason = null;
  post.publishedAt = null;
  await post.save();
  return post;
}

async function listBusinessPosts(businessId, query) {
  const filter = { businessId, ...(query.status ? { status: query.status } : {}) };
  const skip = (query.page - 1) * query.limit;
  const [posts, total] = await Promise.all([ContentPost.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit), ContentPost.countDocuments(filter)]);
  return { posts, total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function listPublicPosts(businessSlug, query, viewerId) {
  const business = await Business.findOne({ slug: businessSlug, status: 'active', moderationStatus: 'approved' }).select('_id name slug');
  if (!business) throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Business not found');
  const filter = { businessId: business._id, status: 'active', moderationStatus: 'approved' };
  const skip = (query.page - 1) * query.limit;
  const [posts, total] = await Promise.all([publicRelations(ContentPost.find(filter)).sort({ publishedAt: -1, createdAt: -1 }).skip(skip).limit(query.limit), ContentPost.countDocuments(filter)]);
  return { posts: await publicPostJSON(posts, viewerId), business: { id: business._id.toString(), name: business.name, slug: business.slug }, total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function listDiscoverPosts(query, businessIds = null, viewerId) {
  const filter = { status: 'active', moderationStatus: 'approved' };
  if (businessIds) filter.businessId = { $in: businessIds };
  if (query.feed === 'following') {
    const followed = viewerId ? await Follow.find({ userId: viewerId }).select('businessId').lean() : [];
    filter.businessId = { $in: followed.map((item) => item.businessId) };
  }
  if (query.feed === 'personalized' && viewerId) {
    const [followed, savedBusinesses] = await Promise.all([
      Follow.find({ userId: viewerId }).select('businessId').lean(),
      Favorite.find({ userId: viewerId, targetType: 'business' }).select('targetId').lean()
    ]);
    const preferredBusinessIds = [...new Set([...followed.map((item) => item.businessId.toString()), ...savedBusinesses.map((item) => item.targetId.toString())])];
    if (preferredBusinessIds.length) filter.businessId = { $in: preferredBusinessIds };
  }
  if (query.postType === 'product_update') filter.type = 'product_update';
  if (query.postType === 'service_update') filter.type = 'service_update';
  if (query.postType === 'updates') filter.type = { $in: ['announcement', 'offer', 'tip'] };
  if (query.postId) filter._id = query.postId;
  if (query.q) {
    const expression = new RegExp(String(query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ title: expression }, { body: expression }, { hashtags: expression }];
  }
  const skip = (query.page - 1) * query.limit;
  const sort = ['trending', 'personalized'].includes(query.feed) ? { likesCount: -1, commentsCount: -1, publishedAt: -1 } : { publishedAt: -1, createdAt: -1 };
  const [posts, total] = await Promise.all([
    publicRelations(ContentPost.find(filter)).sort(sort).skip(skip).limit(query.limit),
    ContentPost.countDocuments(filter)
  ]);
  return { posts: await publicPostJSON(posts, viewerId), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function listSavedPosts(userId, query) {
  const skip = (query.page - 1) * query.limit;
  const [saves, total] = await Promise.all([
    ContentPostSave.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(query.limit).select('postId createdAt').lean(),
    ContentPostSave.countDocuments({ userId })
  ]);
  const postIds = saves.map((save) => save.postId);
  if (!postIds.length) return { posts: [], total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
  const posts = await publicRelations(ContentPost.find({ _id: { $in: postIds }, status: 'active', moderationStatus: 'approved' }));
  const byId = new Map(posts.map((post) => [post._id.toString(), post]));
  const orderedPosts = postIds.map((postId) => byId.get(postId.toString())).filter(Boolean);
  return { posts: await publicPostJSON(orderedPosts, userId), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function listAdminPosts(query) {
  const filter = query.status ? { status: query.status } : { status: 'pending_review' };
  const skip = (query.page - 1) * query.limit;
  const [posts, total] = await Promise.all([ContentPost.find(filter).sort({ createdAt: 1 }).skip(skip).limit(query.limit).populate('businessId', 'name slug'), ContentPost.countDocuments(filter)]);
  return { posts, total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function reviewPost(postId, decision, reason = null) {
  const post = await ContentPost.findById(postId);
  if (!post) throw new AppError(404, 'CONTENT_POST_NOT_FOUND', 'Content post not found');
  if (decision === 'approve') {
    post.status = 'active';
    post.moderationStatus = 'approved';
    post.publishedAt = new Date();
    post.rejectionReason = null;
  } else {
    post.status = 'rejected';
    post.moderationStatus = 'rejected';
    post.rejectionReason = reason;
    post.publishedAt = null;
  }
  await post.save();
  return post;
}

module.exports = { createPost, updatePost, submitPost, listBusinessPosts, listPublicPosts, listDiscoverPosts, listSavedPosts, listAdminPosts, reviewPost, assertPostHasContent, normalizeHashtags, normalizeIds, validateTags };
