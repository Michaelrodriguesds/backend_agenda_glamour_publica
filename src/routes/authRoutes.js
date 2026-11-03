const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/authController");
const { protect } = require("../../src/middlewares/auth");

router.post("/register", ctrl.register); // POST /api/auth/register (pública)
router.post("/login", ctrl.login); // POST /api/auth/login  (pública)
router.post("/forgot-password", ctrl.forgotPassword); // POST /api/auth/forgot-password (pública)
router.post("/reset-password", ctrl.resetPassword); // POST /api/auth/reset-password (pública)
router.get("/verify", protect, ctrl.verifyToken); // GET  /api/auth/verify (protegida)
router.get("/me", protect, ctrl.getMe); // GET  /api/auth/me (protegida)
router.post("/refresh", ctrl.refreshToken); // POST /api/auth/refresh

module.exports = router;
