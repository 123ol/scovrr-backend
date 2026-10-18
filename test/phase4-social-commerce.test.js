const assert = require('node:assert/strict');
const { test } = require('node:test');
const mongoose = require('mongoose');
const { ContentPostSave } = require('../src/modules/content-posts/content-post-save.model');
const { ContentPost } = require('../src/modules/content-posts/content-post.model');
const { ContentPostComment } = require('../src/modules/content-posts/content-post-comment.model');
const { ModerationCase, MODERATION_SUBJECT_TYPES } = require('../src/modules/moderation/moderation-case.model');
const { createEventSchema } = require('../src/modules/analytics/analytics.validation');
const { createSchema, commentCreateSchema, businessCommentCreateSchema } = require('../src/modules/content-posts/content-post.validation');
const { normalizeHashtags } = require('../src/modules/content-posts/content-post.service');
const { savedListSchema, mineListSchema } = require('../src/modules/content-posts/content-post.validation');

test('saved content is durable and unique per viewer and post', () => {
  const indexes = ContentPostSave.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => fields.userId && fields.postId && options.unique));
  const save = new ContentPostSave({ userId: new mongoose.Types.ObjectId(), postId: new mongoose.Types.ObjectId() });
  assert.ok(save.toObject().postId);
});

test('public post payload exposes saved state without exposing owner fields', () => {
  const post = new ContentPost({ _id: new mongoose.Types.ObjectId(), businessId: new mongoose.Types.ObjectId(), authorId: new mongoose.Types.ObjectId(), type: 'announcement', body: 'Video update', media: [{ url: 'https://cdn.example.test/video.mp4', mimeType: 'video/mp4' }] });
  const safe = post.toPublicJSON({ savedByViewer: true });
  assert.equal(safe.savedByViewer, true);
  assert.equal('authorId' in safe, false);
});

test('seller post management exposes engagement counts and threaded comment contracts', () => {
  const post = new ContentPost({ _id: new mongoose.Types.ObjectId(), businessId: new mongoose.Types.ObjectId(), authorId: new mongoose.Types.ObjectId(), type: 'announcement', body: 'Seller update', likesCount: 12, commentsCount: 3 });
  assert.equal(post.toOwnerJSON().likesCount, 12);
  assert.ok(ContentPostComment.schema.path('parentCommentId'));
  assert.ok(ContentPostComment.schema.indexes().some(([fields]) => fields.postId && fields.parentCommentId && fields.status));
  const parentCommentId = new mongoose.Types.ObjectId().toString();
  assert.equal(commentCreateSchema.safeParse({ body: { body: 'A reply', parentCommentId }, params: { postId: post._id.toString() }, query: {} }).success, true);
  assert.equal(businessCommentCreateSchema.safeParse({ body: { body: 'Seller reply', parentCommentId }, params: { businessId: post.businessId.toString(), postId: post._id.toString() }, query: {} }).success, true);
});

test('vertical feed analytics remains a client-observable event', () => {
  const result = createEventSchema.safeParse({ body: { eventName: 'CONTENT_POST_VIEWED', sessionId: 'session-12345', metadata: { postId: new mongoose.Types.ObjectId().toString(), position: 0 } }, params: {}, query: {} });
  assert.equal(result.success, true);
  const watched = createEventSchema.safeParse({ body: { eventName: 'CONTENT_POST_WATCHED', sessionId: 'session-12345', entityType: 'content_post', entityId: new mongoose.Types.ObjectId().toString(), metadata: { watchSeconds: 12 } }, params: {}, query: {} });
  assert.equal(watched.success, true);
});

test('content posts preserve hashtags and support multiple catalogue tag identifiers', () => {
  const result = createSchema.safeParse({ body: { body: 'New drop', hashtags: ['NewDrop', '#LagosStyle'], taggedProductIds: ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'], taggedServiceIds: ['507f1f77bcf86cd799439013'] }, params: { businessId: '507f1f77bcf86cd799439014' }, query: {} });
  assert.equal(result.success, true);
  assert.deepEqual(normalizeHashtags(result.data.body.hashtags), ['#newdrop', '#lagosstyle']);
  assert.equal(ContentPost.schema.path('hashtags').instance, 'Array');
  assert.equal(ContentPost.schema.path('taggedProductIds').instance, 'Array');
  assert.equal(ContentPost.schema.path('taggedServiceIds').instance, 'Array');
});

test('content post media accepts upload metadata without optional alt text', () => {
  const id = '507f1f77bcf86cd799439011';
  const result = createSchema.safeParse({
    body: {
      type: 'announcement',
      body: 'New video update',
      media: [{ url: 'https://cdn.example.test/video.mp4', provider: 'cloudinary', publicId: 'scovrr/video', uploadSessionId: id, mimeType: 'video/mp4', alt: null, order: 0 }],
      hashtags: [],
      linkedProductId: null,
      linkedServiceId: null,
      taggedProductIds: [],
      taggedServiceIds: []
    },
    params: { businessId: id },
    query: {}
  });
  assert.equal(result.success, true);
});

test('content-post reports can persist through the moderation-case subject contract', () => {
  assert.ok(MODERATION_SUBJECT_TYPES.includes('content_post'));
  const moderationCase = new ModerationCase({ caseNumber: 'SCV-MOD-CONTENT-TEST', subjectType: 'content_post', subjectId: new mongoose.Types.ObjectId(), source: 'report', reason: 'inappropriate_media' });
  assert.equal(moderationCase.validateSync(), undefined);
});

test('saved video collection uses bounded pagination', () => {
  const result = savedListSchema.safeParse({ body: {}, params: {}, query: { page: '2', limit: '30' } });
  assert.equal(result.success, true);
  assert.equal(result.data.query.page, 2);
  assert.equal(result.data.query.limit, 30);
});

test('seller content management supports membership-scoped post loading', () => {
  const result = mineListSchema.safeParse({ body: {}, params: {}, query: { page: '1', limit: '20', status: 'active' } });
  assert.equal(result.success, true);
  assert.equal(result.data.query.limit, 20);
  assert.equal(result.data.query.status, 'active');
});
