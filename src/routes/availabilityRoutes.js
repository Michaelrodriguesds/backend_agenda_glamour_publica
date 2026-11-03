const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/availabilityController");
const { protect } = require("../../src/middlewares/auth");
const checkTrial = require("../middlewares/checkTrial");

router.use(protect);
router.use(checkTrial); // bloqueia se trial/liberação expirou

router.get("/", ctrl.getDayAvailability); // GET /api/availability?date=2025-03-01&location=Studio+Aclimação
router.get("/month", ctrl.getMonthAvailability); // GET /api/availability/month?month=3&year=2025&location=...

module.exports = router;
