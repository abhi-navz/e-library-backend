const getHealth = (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'E-Library backend is running'
  });
};

module.exports = { getHealth };
