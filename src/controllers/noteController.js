const Note = require("../models/Note");

// Só estes campos podem vir do app (userId nunca vem do cliente)
const ALLOWED = ["title", "content", "tag", "color", "pinned"];
const pickAllowed = (body = {}) => {
  const out = {};
  for (const k of ALLOWED) if (body[k] !== undefined) out[k] = body[k];
  return out;
};
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ────────────────────────────────────────────────────────────────
// LISTAR anotações
// GET /api/notes
// Query: ?pinned=true | ?tag=geral | ?search=texto | ?limit=50
// ────────────────────────────────────────────────────────────────
exports.getNotes = async (req, res) => {
  try {
    const { pinned, tag, search, limit = 100 } = req.query;
    const filters = { userId: req.user.id };

    if (pinned !== undefined) filters.pinned = pinned === "true";
    if (tag)    filters.tag = tag;   // ← string simples (alinhado com Flutter)
    if (search) {
      filters.$or = [
        { title:   { $regex: esc(search), $options: "i" } },
        { content: { $regex: esc(search), $options: "i" } },
      ];
    }

    const notes = await Note.find(filters)
      .select("-__v")
      .sort({ pinned: -1, updatedAt: -1 })
      .limit(Math.min(parseInt(limit) || 100, 500))
      .lean();

    res.json({ count: notes.length, data: notes });
  } catch (error) {
    console.error("getNotes:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// ────────────────────────────────────────────────────────────────
// BUSCAR por ID
// GET /api/notes/:id
// ────────────────────────────────────────────────────────────────
exports.getNoteById = async (req, res) => {
  try {
    const note = await Note.findOne({ _id: req.params.id, userId: req.user.id });
    if (!note) return res.status(404).json({ error: "Anotação não encontrada" });
    res.json(note);
  } catch (error) {
    console.error("getNoteById:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// ────────────────────────────────────────────────────────────────
// CRIAR anotação
// POST /api/notes
// Body: { title?, content, color?, pinned?, tag? }
// ────────────────────────────────────────────────────────────────
exports.createNote = async (req, res) => {
  try {
    const note = await Note.create({ ...pickAllowed(req.body), userId: req.user.id });
    res.status(201).json(note);
  } catch (error) {
    console.error("createNote:", error);
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ error: "Dados inválidos", messages });
    }
    res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// ────────────────────────────────────────────────────────────────
// ATUALIZAR anotação
// PUT /api/notes/:id
// ────────────────────────────────────────────────────────────────
exports.updateNote = async (req, res) => {
  try {
    const note = await Note.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: pickAllowed(req.body) },
      { returnDocument: 'after', runValidators: true }
    );
    if (!note) return res.status(404).json({ error: "Anotação não encontrada" });
    res.json(note);
  } catch (error) {
    console.error("updateNote:", error);
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ error: "Dados inválidos", messages });
    }
    res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// ────────────────────────────────────────────────────────────────
// DELETAR anotação
// DELETE /api/notes/:id
// ────────────────────────────────────────────────────────────────
exports.deleteNote = async (req, res) => {
  try {
    const note = await Note.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!note) return res.status(404).json({ error: "Anotação não encontrada" });
    res.json({ message: "Anotação removida com sucesso" });
  } catch (error) {
    console.error("deleteNote:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// ────────────────────────────────────────────────────────────────
// FIXAR / DESAFIXAR (toggle pin)
// PATCH /api/notes/:id/pin
// ────────────────────────────────────────────────────────────────
exports.togglePin = async (req, res) => {
  try {
    const note = await Note.findOne({ _id: req.params.id, userId: req.user.id });
    if (!note) return res.status(404).json({ error: "Anotação não encontrada" });

    note.pinned = !note.pinned;
    await note.save();

    res.json({ message: `Anotação ${note.pinned ? "fixada" : "desafixada"}`, data: note });
  } catch (error) {
    console.error("togglePin:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
};

// ────────────────────────────────────────────────────────────────
// LISTAR TODAS AS TAGS usadas
// GET /api/notes/tags
// ────────────────────────────────────────────────────────────────
exports.getAllTags = async (req, res) => {
  try {
    const tags = await Note.distinct("tag", { userId: req.user.id }); // ← campo "tag" string
    res.json({ tags: tags.filter(Boolean).sort() });
  } catch (error) {
    console.error("getAllTags:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
};