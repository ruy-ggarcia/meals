// The recipe editor: a modal dialog that creates a recipe, or changes the
// name and the ingredients of one. It follows the app's interaction rules:
// - Done checks the fields and saves them with one request. The editor
//   closes only when the save succeeds.
// - Cancel, Escape, and Android's Back discard the changes.
// - Clicking the backdrop closes the editor only when nothing changed, so a
//   stray click never throws work away.

import { createCombobox } from "./combobox.js";
import { createButton, createElement, onBackdropClick } from "./dom.js";
import { sendJson } from "./http.js";
import { conflictText } from "./messages.js";
import { filterByName, sortByName } from "./name-search.js";
import { MAX_INGREDIENTS, parseQuantity } from "./quantities.js";

const QUANTITY_MESSAGE = "Enter a quantity from 0.01 to 10000, with up to two decimals.";

function sameIngredients(a, b) {
  return (
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.ingredientId === b[index].ingredientId && entry.quantity === b[index].quantity,
    )
  );
}

export function createRecipeEditor(dialog) {
  const title = dialog.querySelector(".dialog-title");
  const nameField = dialog.querySelector(".name-field");
  const nameMessage = dialog.querySelector(".name-message");
  const rowList = dialog.querySelector(".ingredient-rows");
  const noIngredients = dialog.querySelector(".no-ingredients");
  const search = dialog.querySelector(".option-search");
  const saveMessage = dialog.querySelector(".save-message");
  const doneButton = dialog.querySelector(".done");

  /**
   * The open editing session, or null: { recipe, catalog, rows,
   * restoreFocus, onSaved, busy }. `recipe` is undefined for a new recipe,
   * and `catalog` holds every ingredient by ID. Each row is { ingredientId,
   * text, message }, where `text` is what its quantity field holds.
   */
  let session = null;

  const combobox = createCombobox({
    input: search,
    list: dialog.querySelector(".options"),
    noMatch: dialog.querySelector(".no-match"),
    idPrefix: "ingredient-option",
    matches: addableIngredients,
    label: (ingredient) => `${ingredient.name} (${ingredient.unit})`,
    onPick: (ingredient) => add(ingredient.id),
    isDisabled: isFull,
  });

  function isFull() {
    return session.rows.length >= MAX_INGREDIENTS;
  }

  // The rows that `recipe` starts with.
  function rowsOf(recipe) {
    return (recipe?.ingredients ?? []).map(({ ingredientId, quantity }) => ({
      ingredientId,
      text: String(quantity),
      message: "",
    }));
  }

  function open({ recipe, ingredients, restoreFocus, onSaved }) {
    session = {
      recipe,
      catalog: new Map(ingredients.map((ingredient) => [ingredient.id, ingredient])),
      rows: rowsOf(recipe),
      restoreFocus,
      onSaved,
      busy: false,
    };
    title.textContent = recipe ? "Edit recipe" : "New recipe";
    nameField.value = recipe?.name ?? "";
    nameMessage.textContent = "";
    saveMessage.textContent = "";
    setBusy(false);
    renderRows();
    combobox.reset();
    dialog.showModal();
    // A new recipe starts with its name. An existing one starts on the
    // title: on a phone, focusing a field opens the keyboard.
    (recipe ? title : nameField).focus();
  }

  function isOpen() {
    return session !== null;
  }

  /** True when the fields differ from what the editor opened with. */
  function hasChanges() {
    if (session === null) return false;
    const original = rowsOf(session.recipe);
    return (
      nameField.value !== (session.recipe?.name ?? "") ||
      session.rows.length !== original.length ||
      session.rows.some(
        (row, index) =>
          row.ingredientId !== original[index].ingredientId || row.text !== original[index].text,
      )
    );
  }

  // Closes the editor. After a save, `onSaved` gets the saved recipe and
  // moves focus. Otherwise, `restoreFocus` returns focus to the control that
  // opened the editor.
  function finish(saved) {
    if (session === null) return;
    const { restoreFocus, onSaved } = session;
    session = null;
    if (dialog.open) dialog.close();
    if (saved) onSaved(saved);
    else restoreFocus();
  }

  function setBusy(busy) {
    session.busy = busy;
    for (const control of dialog.querySelectorAll("input, button")) control.disabled = busy;
    search.disabled = busy || isFull();
  }

  function rowElement(row, index) {
    const ingredient = session.catalog.get(row.ingredientId);
    const name = ingredient?.name ?? "Unknown ingredient";
    const item = createElement("li", "ingredient-row");
    const field = createElement("input", "quantity-field");
    field.type = "text";
    field.value = row.text;
    field.setAttribute("autocomplete", "off");
    field.setAttribute("inputmode", "decimal");
    field.setAttribute("aria-label", `Quantity of ${name} per serving`);
    field.addEventListener("input", () => {
      row.text = field.value;
    });
    const remove = createButton("Remove", `Remove ${name}`, "remove");
    remove.addEventListener("click", () => removeRow(index));
    item.append(
      createElement("span", "ingredient-name", ingredient?.archived ? `${name} (archived)` : name),
      field,
      createElement("span", "unit", ingredient?.unit ?? ""),
      remove,
    );
    if (row.message) {
      field.setAttribute("aria-invalid", "true");
      item.append(createElement("p", "row-message", row.message));
    }
    return item;
  }

  function renderRows() {
    rowList.replaceChildren(...session.rows.map(rowElement));
    noIngredients.hidden = session.rows.length > 0;
    search.disabled = session.busy || isFull();
    search.placeholder = isFull() ? `A recipe holds up to ${MAX_INGREDIENTS} ingredients.` : "";
  }

  // The active ingredients that aren't in the recipe yet and match `query`,
  // from A to Z.
  function addableIngredients(query) {
    const used = new Set(session.rows.map((row) => row.ingredientId));
    const offered = [...session.catalog.values()].filter(
      (ingredient) => !ingredient.archived && !used.has(ingredient.id),
    );
    return sortByName(filterByName(offered, query));
  }

  // Adds a row with an empty quantity, and focuses its field.
  function add(ingredientId) {
    session.rows.push({ ingredientId, text: "", message: "" });
    renderRows();
    combobox.reset();
    rowList.lastElementChild.querySelector(".quantity-field").focus();
  }

  // After Remove takes a row out, focus the Remove button of the row now in
  // its place, else of the previous row, else the title. Focusing the search
  // field instead would open the keyboard on a phone.
  function removeRow(index) {
    session.rows.splice(index, 1);
    renderRows();
    combobox.render();
    const row = rowList.children[Math.min(index, rowList.children.length - 1)];
    (row?.querySelector(".remove") ?? title).focus();
  }

  // Reads every quantity and shows a message under each invalid one. Returns
  // the recipe's ingredients, or null when any quantity is invalid.
  function readIngredients() {
    const ingredients = [];
    for (const row of session.rows) {
      const quantity = parseQuantity(row.text);
      row.message = quantity === null ? QUANTITY_MESSAGE : "";
      if (quantity !== null) ingredients.push({ ingredientId: row.ingredientId, quantity });
    }
    renderRows();
    return ingredients.length === session.rows.length ? ingredients : null;
  }

  // The request body: the whole recipe when it's new, else only the fields
  // that changed, or null when nothing did.
  function changes(name, ingredients) {
    const { recipe } = session;
    if (!recipe) return { name, ingredients };
    const body = {};
    if (name !== recipe.name) body.name = name;
    if (!sameIngredients(ingredients, recipe.ingredients)) body.ingredients = ingredients;
    return Object.keys(body).length > 0 ? body : null;
  }

  // Sends `body`. Returns the saved recipe, or undefined after showing why
  // the save failed.
  async function send(body) {
    const { recipe } = session;
    try {
      const { status, body: reply } = recipe
        ? await sendJson("PATCH", `/api/recipes/${encodeURIComponent(recipe.id)}`, body)
        : await sendJson("POST", "/api/recipes", body);
      if (status === 200 || status === 201) return reply;
      if (status === 409 && reply.recipe) {
        const text = conflictText(reply.recipe);
        nameMessage.textContent = reply.recipe.archived
          ? `${text} To use it, restore it from Archived.`
          : text;
        return undefined;
      }
      if (status === 400 && typeof reply.error === "string") {
        saveMessage.textContent = reply.error;
        return undefined;
      }
      throw new Error(`HTTP ${status}`);
    } catch (error) {
      console.error("Couldn't save the recipe:", error);
      saveMessage.textContent = "Couldn't save the recipe. Try again.";
      return undefined;
    }
  }

  async function save() {
    if (session === null || session.busy) return;
    nameMessage.textContent = nameField.value.trim() === "" ? "The name can't be empty." : "";
    saveMessage.textContent = "";
    const ingredients = readIngredients();
    if (nameMessage.textContent !== "") {
      nameField.focus();
      return;
    }
    if (ingredients === null) {
      rowList.querySelector('[aria-invalid="true"]').focus();
      return;
    }
    const body = changes(nameField.value, ingredients);
    if (body === null) {
      finish();
      return;
    }
    setBusy(true);
    const saved = await send(body);
    setBusy(false);
    if (saved) finish(saved);
    else if (nameMessage.textContent !== "") nameField.focus();
    else doneButton.focus();
  }

  dialog.querySelector(".cancel").addEventListener("click", () => finish());
  doneButton.addEventListener("click", save);
  // Escape and Android's Back close the dialog, which discards the changes,
  // except while a save runs.
  dialog.addEventListener("cancel", (event) => {
    if (session?.busy) event.preventDefault();
  });
  dialog.addEventListener("close", () => finish());
  onBackdropClick(dialog, () => {
    if (session !== null && !session.busy && !hasChanges()) finish();
  });
  // Enter confirms the innermost edit. In Name, in a quantity, on the title,
  // or on the dialog itself, that's Done. Buttons and Add ingredient handle
  // their own Enter.
  dialog.addEventListener("keydown", (event) => {
    if (event.isComposing || event.key !== "Enter") return;
    const { target } = event;
    if (
      target === title ||
      target === dialog ||
      target === nameField ||
      target.classList.contains("quantity-field")
    ) {
      event.preventDefault();
      save();
    }
  });

  return { hasChanges, isOpen, open };
}
