const { AppError } = require('../../common/errors/AppError');
const { Address } = require('./address.model');

async function makeDefault(userId, addressId) {
  await Address.updateMany({ userId, _id: { $ne: addressId } }, { $set: { isDefault: false } });
  await Address.updateOne({ userId, _id: addressId }, { $set: { isDefault: true } });
}

async function listAddresses(userId) {
  const addresses = await Address.find({ userId }).sort({ isDefault: -1, createdAt: -1 });
  return addresses.map((address) => address.toSafeJSON());
}

async function createAddress(userId, input) {
  const hasAddresses = await Address.exists({ userId });
  const address = await Address.create({ userId, ...input, location: input.coordinates ? { type: 'Point', coordinates: input.coordinates } : undefined, isDefault: input.isDefault || !hasAddresses });
  if (address.isDefault) await makeDefault(userId, address._id);
  return address;
}

async function updateAddress(userId, addressId, input) {
  const address = await Address.findOne({ _id: addressId, userId });
  if (!address) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
  const { coordinates, ...fields } = input;
  Object.assign(address, fields);
  if (coordinates !== undefined) address.location = { type: 'Point', coordinates };
  await address.save();
  if (input.isDefault) await makeDefault(userId, address._id);
  return address;
}

async function deleteAddress(userId, addressId) {
  const address = await Address.findOneAndDelete({ _id: addressId, userId });
  if (!address) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
  if (address.isDefault) {
    const replacement = await Address.findOne({ userId }).sort({ createdAt: -1 });
    if (replacement) await makeDefault(userId, replacement._id);
  }
}

async function getOwnedAddress(userId, addressId) {
  const address = await Address.findOne({ _id: addressId, userId });
  if (!address) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
  return address;
}

module.exports = { listAddresses, createAddress, updateAddress, deleteAddress, getOwnedAddress };
