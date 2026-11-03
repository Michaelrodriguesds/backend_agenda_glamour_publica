const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/businessController");
const { protect } = require("../../src/middlewares/auth");

// Importante: SEM checkTrial aqui — mesmo bloqueado, o usuário
// precisa conseguir ver a própria config (ex: pra conferir o businessId).
router.use(protect);

router.get("/config", ctrl.getConfig); // GET /api/business/config
router.put("/config", ctrl.updateConfig); // PUT /api/business/config

module.exports = router;
