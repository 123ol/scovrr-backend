function sendSuccess(res, data, meta) {
  return res.status(200).json({
    success: true,
    data,
    ...(meta ? { meta } : {})
  });
}

module.exports = { sendSuccess };
