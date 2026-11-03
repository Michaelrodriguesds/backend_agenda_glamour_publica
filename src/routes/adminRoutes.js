const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/adminController");
const adminAuth = require("../middlewares/adminAuth");

// Todas protegidas pela ADMIN_KEY (header x-admin-key), não por login de usuário
router.use(adminAuth);

router.get("/users", ctrl.listUsers); // GET   /api/admin/users
router.get("/users/:businessId", ctrl.getUserByBusinessId); // GET   /api/admin/users/:businessId
router.patch("/users/:businessId/unlock", ctrl.unlockUser); // PATCH /api/admin/users/:businessId/unlock
router.patch("/users/:businessId/block", ctrl.blockUser); // PATCH /api/admin/users/:businessId/block

module.exports = router;
