const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/feedbackController");
const { protect } = require("../middlewares/auth");

// Só login (SEM checkTrial): quem está bloqueado também pode pedir ajuda.
router.post("/", protect, ctrl.create);

module.exports = router;
