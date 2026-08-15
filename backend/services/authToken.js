const jwt = require("jsonwebtoken");

function signToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      centerId: user.center_id,
      mustChangePassword: user.must_change_password === 1,
    },
    process.env.JWT_SECRET,
    { expiresIn: "12h" },
  );
}

module.exports = { signToken };
