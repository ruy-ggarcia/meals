// The ingredient editor: a modal dialog that creates an ingredient, or
// changes the name, the unit, and the measures of one. It follows the app's
// interaction rules:
// - Done checks the fields and saves the changes with one request. The editor
//   closes only when the save succeeds.
// - Cancel, Escape, and Android's Back discard the changes.
// - Clicking the backdrop closes the editor only when nothing changed.

import { createButton, createElement } from "./dom.js";
import { createEditorDialog } from "./editor-dialog.js";
import { sendJson } from "./http.js";
import { conflictText } from "./messages.js";
import { nameKey } from "./name-search.js";
import { MAX_MEASURES, parseQuantity } from "./quantities.js";

const AMOUNT_MESSAGE = "Enter an amount from 0.01 to 10000, with up to two decimals.";
const CONVERSION_MESSAGE = "Enter a number from 0.01 to 10000, with up to two decimals.";

// Why a measure can't be removed while `count` recipes use it.
function measureUsedText(count) {
  return count === 1 ? "Used in 1 recipe." : `Used in ${count} recipes.`;
}

// The name as the server stores it: trimmed, with runs of whitespace collapsed.
function cleanName(name) {
  return name.trim().replace(/\s+/g, " ");
}

// The measure rows that `ingredient` starts with.
function rowsOf(ingredient) {
  return (ingredient?.measures ?? []).map(({ id, name, amount }) => ({
    id,
    name,
    amountText: String(amount),
    message: "",
  }));
}

function sameMeasures(a, b) {
  return (
    a.length === b.length &&
    a.every(
      (measure, index) =>
        measure.id === b[index].id &&
        measure.name === b[index].name &&
        measure.amount === b[index].amount,
    )
  );
}

export function createIngredientEditor(dialog) {
  const title = dialog.querySelector(".dialog-title");
  const nameField = dialog.querySelector(".name-field");
  const nameMessage = dialog.querySelector(".name-message");
  const unitField = dialog.querySelector(".unit-field");
  const noUnitOption = unitField.querySelector('option[value=""]');
  const conversionRow = dialog.querySelector(".conversion");
  const conversionFrom = conversionRow.querySelector(".conversion-from");
  const conversionFromUnit = conversionRow.querySelector(".conversion-from-unit");
  const conversionTo = conversionRow.querySelector(".conversion-to");
  const conversionToUnit = conversionRow.querySelector(".conversion-to-unit");
  const conversionMeasure = conversionRow.querySelector(".conversion-measure");
  const conversionMeasureName = conversionRow.querySelector(".conversion-measure-name");
  const conversionMessage = conversionRow.querySelector(".conversion-message");
  const measureList = dialog.querySelector(".measure-rows");
  const addMeasureButton = dialog.querySelector(".add-measure");
  const saveMessage = dialog.querySelector(".save-message");

  /**
   * What the editor last opened with: { ingredient, usage, rows }.
   * `ingredient` is undefined for a new one. Each row is
   * { id?, name, amountText, message, invalid? }: `name` and `amountText` are
   * what its fields hold, only a measure that exists has an `id`, and
   * `invalid` is the field that `message` is about.
   */
  let session = null;

  const lifecycle = createEditorDialog({
    dialog,
    hasChanges,
    onDone: save,
    // The dialog disables inputs and buttons, not the select.
    onBusy: (busy) => {
      unitField.disabled = busy;
      syncControls();
    },
    // Enter in a measure field is Done too. Add measure handles its own Enter.
    confirms: (target) =>
      target.classList.contains("measure-name") || target.classList.contains("measure-amount"),
  });

  function isFull() {
    return session.rows.length >= MAX_MEASURES;
  }

  // How many recipes use the measure of `row`.
  function usedBy(row) {
    return (row.id && session.usage.measures.get(row.id)) || 0;
  }

  // True when the selected unit differs from the stored one and something
  // depends on the old unit, so the change needs a conversion.
  function needsConversion() {
    const { ingredient, usage } = session;
    return (
      Boolean(ingredient) &&
      unitField.value !== ingredient.unit &&
      ((ingredient.measures ?? []).length > 0 || usage.inUnit)
    );
  }

  // The amount that a measure row shows: the stored amount, or its preview in
  // the new unit while the conversion row shows and both numbers parse. The
  // preview multiplies and rounds as the server does, so it shows the amount
  // that the server saves.
  function shownAmount(row) {
    if (!needsConversion()) return row.amountText;
    const from = parseQuantity(conversionFrom.value);
    const to = parseQuantity(conversionTo.value);
    if (from === null || to === null) return row.amountText;
    const factor = to / from;
    return String(Math.round(Number(row.amountText) * factor * 100) / 100);
  }

  // Disables Remove on the measures in use, and Add measure at the limit.
  // While the conversion row shows, the rows are previews, so both stay off.
  // The dialog enables every button after a save, so this runs again then.
  function syncControls() {
    const busy = lifecycle.isBusy();
    const preview = needsConversion();
    addMeasureButton.disabled = busy || preview || isFull();
    session.rows.forEach((row, index) => {
      measureList.children[index].querySelector(".remove").disabled =
        busy || preview || usedBy(row) > 0;
    });
  }

  function amountLabel(row) {
    return `Amount of ${row.name} in ${unitField.value}`;
  }

  function rowElement(row, index) {
    const item = createElement("li", "measure-row ingredient-row");
    const nameInput = createElement("input", "measure-name");
    nameInput.type = "text";
    nameInput.value = row.name;
    nameInput.setAttribute("autocomplete", "off");
    nameInput.setAttribute("aria-label", "Measure name");
    const amountInput = createElement("input", "measure-amount quantity-field");
    amountInput.type = "text";
    amountInput.value = shownAmount(row);
    if (needsConversion()) {
      nameInput.readOnly = true;
      amountInput.readOnly = true;
    }
    amountInput.setAttribute("autocomplete", "off");
    amountInput.setAttribute("inputmode", "decimal");
    amountInput.setAttribute("aria-label", amountLabel(row));
    // Editing the field that the row's message is about clears the message,
    // without a re-render, which would take the focus away.
    function clearMessage(field, input) {
      if (row.message === "" || row.invalid !== field) return;
      row.message = "";
      input.removeAttribute("aria-invalid");
      item.querySelector(".row-message")?.remove();
    }
    nameInput.addEventListener("input", () => {
      row.name = nameInput.value;
      amountInput.setAttribute("aria-label", amountLabel(row));
      clearMessage("name", nameInput);
    });
    amountInput.addEventListener("input", () => {
      row.amountText = amountInput.value;
      clearMessage("amount", amountInput);
    });
    const remove = createButton("Remove", `Remove ${row.name}`, "remove");
    remove.addEventListener("click", () => removeRow(index));
    item.append(
      nameInput,
      "=",
      amountInput,
      createElement("span", "unit", unitField.value),
      remove,
    );
    if (usedBy(row) > 0) item.append(createElement("p", "row-hint", measureUsedText(usedBy(row))));
    if (row.message) {
      (row.invalid === "name" ? nameInput : amountInput).setAttribute("aria-invalid", "true");
      item.append(createElement("p", "row-message", row.message));
    }
    return item;
  }

  function renderRows() {
    measureList.replaceChildren(...session.rows.map(rowElement));
    syncControls();
  }

  // Adds an empty row, and focuses its name.
  function addRow() {
    session.rows.push({ name: "", amountText: "", message: "" });
    renderRows();
    measureList.lastElementChild.querySelector(".measure-name").focus();
  }

  // After Remove takes a row out, focus the Remove button of the row now in
  // its place, else of the previous row, else the title. A button that's
  // disabled can't take focus, and focusing a field opens the keyboard on a
  // phone.
  function removeRow(index) {
    session.rows.splice(index, 1);
    renderRows();
    const rows = measureList.children;
    const enabled = ".remove:not(:disabled)";
    (
      rows[index]?.querySelector(enabled) ??
      rows[index - 1]?.querySelector(enabled) ??
      title
    ).focus();
  }

  function clearConversionMessage() {
    conversionMessage.textContent = "";
    for (const field of [conversionFrom, conversionTo, conversionMeasureName]) {
      field.removeAttribute("aria-invalid");
    }
  }

  // Shows the conversion row when the unit change needs one, else hides it.
  // A new row starts at 1 old unit, and names the measure after the old unit.
  function showConversion() {
    clearConversionMessage();
    const needed = needsConversion();
    if (needed && conversionRow.hidden) {
      conversionFrom.value = "1";
      conversionTo.value = "";
      conversionMeasureName.value = session.ingredient.unit;
    }
    conversionRow.hidden = !needed;
    if (needed) {
      conversionFromUnit.textContent = session.ingredient.unit;
      conversionToUnit.textContent = unitField.value;
    }
    conversionMeasure.hidden = !(needed && session.usage.inUnit);
  }

  function open({ ingredient, usage, restoreFocus, onSaved }) {
    session = { ingredient, usage, rows: rowsOf(ingredient) };
    title.textContent = ingredient ? "Edit ingredient" : "New ingredient";
    nameField.value = ingredient?.name ?? "";
    // Choosing a unit applies to a new ingredient only.
    noUnitOption.hidden = Boolean(ingredient);
    unitField.value = ingredient?.unit ?? "";
    nameMessage.textContent = "";
    saveMessage.textContent = "";
    conversionRow.hidden = true;
    showConversion();
    renderRows();
    // The title of an existing ingredient, not a field: on a phone, focusing a
    // field opens the keyboard.
    lifecycle.open({ focus: ingredient ? title : nameField, restoreFocus, onSaved });
  }

  /** True when the fields differ from the ingredient. */
  function hasChanges() {
    return (
      lifecycle.isOpen() &&
      (nameField.value !== (session.ingredient?.name ?? "") ||
        unitField.value !== (session.ingredient?.unit ?? "") ||
        measuresChanged())
    );
  }

  // True when the rows differ from the measures that the editor opened with.
  function measuresChanged() {
    const original = rowsOf(session.ingredient);
    return (
      session.rows.length !== original.length ||
      session.rows.some(
        (row, index) =>
          row.id !== original[index].id ||
          row.name !== original[index].name ||
          row.amountText !== original[index].amountText,
      )
    );
  }

  // Reads every row and shows a message under each invalid one. Returns the
  // measures to send, or null when any row is invalid.
  function readMeasures() {
    const hadMessages = session.rows.some((row) => row.message !== "");
    const measures = [];
    const keys = new Set();
    for (const row of session.rows) {
      const name = cleanName(row.name);
      const amount = parseQuantity(row.amountText);
      row.message = "";
      if (name === "") {
        row.message = "Enter a name.";
        row.invalid = "name";
      } else if (keys.has(nameKey(name))) {
        row.message = `"${name}" is already a measure.`;
        row.invalid = "name";
      } else if (amount === null) {
        row.message = AMOUNT_MESSAGE;
        row.invalid = "amount";
      }
      keys.add(nameKey(name));
      measures.push(row.id ? { id: row.id, name, amount } : { name, amount });
    }
    const valid = session.rows.every((row) => row.message === "");
    // Rendering replaces the fields, so it runs only when a message shows or
    // goes away, and a valid Done keeps the focus where it was.
    if (hadMessages || !valid) renderRows();
    return valid ? measures : null;
  }

  // Sends `body`. Returns the saved ingredient, or undefined after showing why
  // the save failed.
  async function send(body) {
    const { ingredient } = session;
    try {
      const { status, body: reply } = ingredient
        ? await sendJson("PATCH", `/api/ingredients/${encodeURIComponent(ingredient.id)}`, body)
        : await sendJson("POST", "/api/ingredients", body);
      if (status === 200 || status === 201) return reply;
      if (status === 409 && reply.ingredient) {
        const text = conflictText(reply.ingredient);
        nameMessage.textContent = reply.ingredient.archived
          ? `${text} To use it, restore it from Archived.`
          : text;
        return undefined;
      }
      if ((status === 400 || status === 409) && typeof reply.error === "string") {
        saveMessage.textContent = reply.error;
        return undefined;
      }
      throw new Error(`HTTP ${status}`);
    } catch (error) {
      console.error("Couldn't save the ingredient:", error);
      saveMessage.textContent = "Couldn't save the ingredient. Try again.";
      return undefined;
    }
  }

  // Reads the conversion row. Returns the conversion to send, or null after
  // showing why it can't be sent.
  function readConversion() {
    clearConversionMessage();
    const from = parseQuantity(conversionFrom.value);
    const to = parseQuantity(conversionTo.value);
    const measureName = cleanName(conversionMeasureName.value);
    const invalid = [
      [from === null, conversionFrom, CONVERSION_MESSAGE],
      [to === null, conversionTo, CONVERSION_MESSAGE],
      [!conversionMeasure.hidden && measureName === "", conversionMeasureName, "Enter a name."],
    ].find(([failed]) => failed);
    if (invalid) {
      const [, field, message] = invalid;
      conversionMessage.textContent = message;
      field.setAttribute("aria-invalid", "true");
      field.focus();
      return null;
    }
    return conversionMeasure.hidden ? { from, to } : { from, to, measureName };
  }

  // Checks the name and the measures, then saves what changed, or closes when
  // nothing did.
  function save() {
    nameMessage.textContent = nameField.value.trim() === "" ? "The name can't be empty." : "";
    saveMessage.textContent = "";
    const converting = needsConversion();
    const measures = converting ? [] : readMeasures();
    if (nameMessage.textContent !== "") {
      nameField.focus();
      return;
    }
    if (measures === null) {
      measureList.querySelector('[aria-invalid="true"]').focus();
      return;
    }
    const { ingredient } = session;
    const conversion = converting ? readConversion() : undefined;
    if (conversion === null) return;
    if (!ingredient && unitField.value === "") {
      saveMessage.textContent = "Choose a unit.";
      unitField.focus();
      return;
    }
    const body = {};
    if (nameField.value !== (ingredient?.name ?? "")) body.name = nameField.value;
    if (unitField.value !== (ingredient?.unit ?? "")) body.unit = unitField.value;
    if (conversion) body.conversion = conversion;
    else if (
      ingredient ? !sameMeasures(measures, ingredient.measures ?? []) : measures.length > 0
    ) {
      // The amounts are in the selected unit. If the stored unit changed
      // since the editor opened, the server sees a unit change and rejects
      // it, instead of reading the amounts in the wrong unit.
      body.unit = unitField.value;
      body.measures = measures;
    }
    if (Object.keys(body).length === 0) lifecycle.close();
    else lifecycle.submit(() => send(body));
  }

  // The unit appears after every amount. A unit change that needs a
  // conversion needs the measures saved first, since the server converts the
  // stored ones.
  unitField.addEventListener("change", () => {
    saveMessage.textContent = "";
    if (needsConversion() && measuresChanged()) {
      unitField.value = session.ingredient.unit;
      saveMessage.textContent = "Save your changes to the measures before you change the unit.";
    }
    showConversion();
    renderRows();
  });
  for (const field of [conversionFrom, conversionTo]) field.addEventListener("input", renderRows);
  addMeasureButton.addEventListener("click", addRow);

  return { hasChanges, open };
}
