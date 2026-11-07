const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/clientController");
const { protect } = require("../middlewares/auth");
const checkTrial  = require("../middlewares/checkTrial");

router.use(protect);
router.use(checkTrial);

router.get("/", ctrl.getClients); // GET /api/clients?search=

module.exports = router;
