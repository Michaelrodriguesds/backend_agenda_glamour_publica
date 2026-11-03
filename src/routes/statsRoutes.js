const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/statsController");
const { protect } = require("../../src/middlewares/auth");
const checkTrial = require("../middlewares/checkTrial");

router.use(protect);
router.use(checkTrial); // bloqueia se trial/liberação expirou

router.get("/monthly", ctrl.getMonthlyStats); // GET /api/stats/monthly?month=&year=
router.get("/trend", ctrl.getTrendStats);     // GET /api/stats/trend?year=   (o app chama essa rota)

module.exports = router;
