const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/noteController");
const { protect } = require("../../src/middlewares/auth");
const checkTrial = require("../middlewares/checkTrial");
const validateId = require("../middlewares/validateId");

// Todas as rotas protegidas por JWT
router.use(protect);
router.use(checkTrial); // bloqueia se trial/liberação expirou
router.param("id", validateId); // ID malformado → 400 (e não erro 500)

router.get("/tags", ctrl.getAllTags); // GET  /api/notes/tags          ← antes de /:id
router.get("/", ctrl.getNotes); // GET  /api/notes
router.post("/", ctrl.createNote); // POST /api/notes
router.get("/:id", ctrl.getNoteById); // GET  /api/notes/:id
router.put("/:id", ctrl.updateNote); // PUT  /api/notes/:id
router.delete("/:id", ctrl.deleteNote); // DEL  /api/notes/:id
router.patch("/:id/pin", ctrl.togglePin); // PATCH /api/notes/:id/pin

module.exports = router;
