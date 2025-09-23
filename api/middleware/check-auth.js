const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  try {
    const decoded = jwt.verify(req.body.token, process.env.JWT_KEY); //If token is not provided, this will always fail
    req.userData = decoded;
  } catch (error) {
    return res.status(401).json({
      message: "Auth Failed",
    });
  }

  next();
};

//http://localhost:3001/indproviders/verify/:userID
