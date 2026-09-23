const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { env } = require('../config/env');
const { User } = require('../modules/users/user.model');
const conversationService = require('../modules/conversations/conversation.service');
const { BusinessMembership } = require('../modules/businesses/business-membership.model');
const { BusinessLocation } = require('../modules/businesses/business-location.model');

function attachSocketServer(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const payload = jwt.verify(token, env.jwtAccessSecret, { algorithms: ['HS256'] });
      const user = await User.findById(payload.sub);
      if (!user || !['active', 'suspended'].includes(user.status) || payload.typ !== 'access') return next(new Error('AUTHENTICATION_REQUIRED'));
      socket.user = user;
      return next();
    } catch (_error) { return next(new Error('AUTHENTICATION_REQUIRED')); }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user._id.toString()}`);
    socket.on('business:join', async (input = {}, callback = () => {}) => {
      try {
        if (!mongoose.isValidObjectId(input.businessId) || input.locationId && !mongoose.isValidObjectId(input.locationId)) throw new Error('INVALID_BUSINESS_OR_LOCATION');
        const membership = await BusinessMembership.findOne({ businessId: input.businessId, userId: socket.user._id, status: 'active' });
        if (!membership) throw new Error('BUSINESS_ACCESS_REQUIRED');
        if (input.locationId && membership.locationAccess?.mode === 'selected' && !membership.locationAccess.locationIds.some((id) => id.toString() === input.locationId)) throw new Error('BUSINESS_LOCATION_ACCESS_REQUIRED');
        if (input.locationId && !await BusinessLocation.exists({ _id: input.locationId, businessId: input.businessId })) throw new Error('LOCATION_NOT_FOUND');
        socket.join(`business:${input.businessId}`);
        if (input.locationId) socket.join(`location:${input.locationId}`);
        callback({ success: true });
      } catch (error) { callback({ success: false, code: error.message || 'BUSINESS_ACCESS_DENIED' }); }
    });
    socket.on('conversation:join', async (conversationId, callback = () => {}) => {
      try { await conversationService.getConversation(socket.user._id, conversationId); socket.join(`conversation:${conversationId}`); callback({ success: true }); } catch (error) { callback({ success: false, code: error.code || 'CONVERSATION_ACCESS_DENIED' }); }
    });
    socket.on('message:send', async (input, callback = () => {}) => {
      try { const result = await conversationService.sendMessage(socket.user._id, input.conversationId, input); const message = result.message.toSafeJSON(); io.to(`conversation:${input.conversationId}`).emit('message:new', message); callback({ success: true, data: { message } }); } catch (error) { callback({ success: false, code: error.code || 'MESSAGE_FAILED', message: error.message }); }
    });
    socket.on('message:read', async (conversationId, callback = () => {}) => {
      try { await conversationService.markRead(socket.user._id, conversationId); io.to(`conversation:${conversationId}`).emit('message:read', { conversationId, userId: socket.user._id.toString() }); callback({ success: true }); } catch (error) { callback({ success: false, code: error.code || 'MESSAGE_READ_FAILED' }); }
    });
  });
  return io;
}

module.exports = { attachSocketServer };
