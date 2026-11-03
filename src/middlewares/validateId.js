const mongoose = require("mongoose");

// Usado com router.param("id", validateId): ID malformado vira 400 em vez de
// estourar um CastError (erro 500) dentro do controller.
module.exports = (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: "ID inválido" });
  }
  next();
};
