module.exports.assertCronAuth = (req, res, next) => {
  const header = req.get('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_TOKEN || token !== process.env.CRON_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};
