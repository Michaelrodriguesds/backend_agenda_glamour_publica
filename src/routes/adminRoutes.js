const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/adminController");
const adminAuth = require("../middlewares/adminAuth");
const feedback = require("../controllers/feedbackController");
const announcement = require("../controllers/announcementController");
const validateId = require("../middlewares/validateId");

// Todas protegidas pela ADMIN_KEY (header x-admin-key), não por login de usuário
router.use(adminAuth);
router.param("id", validateId); // relato com ID malformado → 400

router.get("/users", ctrl.listUsers); // GET   /api/admin/users
router.get("/users/:businessId", ctrl.getUserByBusinessId); // GET   /api/admin/users/:businessId
router.patch("/users/:businessId/unlock", ctrl.unlockUser); // PATCH /api/admin/users/:businessId/unlock
router.patch("/users/:businessId/block", ctrl.blockUser); // PATCH /api/admin/users/:businessId/block
router.patch("/users/:businessId/reset-password", ctrl.resetPassword); // PATCH senha temporária (e-mail não chegou)
router.delete("/users/:businessId", ctrl.deleteUser); // DELETE ?confirm=ID — só usuário bloqueado/vencido


// Relatos dos usuários (erros / melhorias)
router.get("/feedback", feedback.list);            // GET    /api/admin/feedback?status=novo
router.patch("/feedback/:id", feedback.setStatus); // PATCH  /api/admin/feedback/:id  {status}
router.delete("/feedback/:id", feedback.remove);   // DELETE /api/admin/feedback/:id

// Aviso global de manutenção / atualização
router.get("/announcement", announcement.getAdmin); // GET /api/admin/announcement
router.put("/announcement", announcement.set);      // PUT /api/admin/announcement  {active,type,message}

module.exports = router;
