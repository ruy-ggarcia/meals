import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { ValidationError } from "../server/errors.js";
import {
  changesUnit,
  convertedAmount,
  missingConversion,
  normalize,
  normalizeMeasures,
  planUnitChange,
  removedMeasureInUse,
  removedMeasures,
  unitChangeError,
  unitMeasure,
  validChanges,
  validConversion,
  validMeasures,
  validNewIngredient,
  validUnit,
  withIngredientChanges,
  withNewIngredient,
} from "../server/ingredients.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const wrongQuantity = "must be from 0.01 to 10000, with at most two decimals.";
const wrongMeasure = 'measures[0] must have "name" and "amount", or also "id".';
const wrongConversion = '"conversion" must have "from" and "to", and optionally "measureName".';

/** The error that a rule throws: a ValidationError with this exact message. */
function invalid(message) {
  return { name: "ValidationError", message };
}

function ingredient(fields) {
  return { id: "i1", name: "Onion", unit: "g", measures: [], archived: false, ...fields };
}

const medium = { id: "m1", name: "medium", amount: 150 };

describe("validUnit", () => {
  test("accepts g, ml, and pcs, and returns the unit", () => {
    for (const unit of ["g", "ml", "pcs"]) {
      assert.equal(validUnit(unit), unit);
    }
  });

  test("rejects any other unit", () => {
    for (const unit of ["kg", "G", "", undefined, null, 5, ["g"]]) {
      assert.throws(
        () => validUnit(unit),
        invalid('"unit" must be one of g, ml, pcs.'),
        String(unit),
      );
    }
  });
});

describe("validMeasures", () => {
  test("rejects measures that aren't an array", () => {
    for (const measures of [undefined, null, "medium", {}, 7]) {
      assert.throws(
        () => validMeasures(measures, []),
        invalid('"measures" must be an array.'),
        String(measures),
      );
    }
  });

  test("rejects more than 20 measures, and accepts exactly 20", () => {
    const measures = (count) =>
      Array.from({ length: count }, (_, index) => ({ name: `m${index}`, amount: index + 1 }));

    assert.throws(
      () => validMeasures(measures(21), []),
      invalid("An ingredient holds at most 20 measures."),
    );
    assert.equal(validMeasures(measures(20), []).length, 20);
  });

  test("rejects an entry without exactly name and amount, or those and id", () => {
    const entries = [
      null,
      "medium",
      [],
      {},
      { name: "medium" },
      { amount: 1 },
      { name: "medium", amount: 1, color: "red" },
      { id: "x", name: "medium" },
    ];
    for (const entry of entries) {
      assert.throws(
        () => validMeasures([entry], [medium]),
        invalid(wrongMeasure),
        JSON.stringify(entry),
      );
    }
  });

  test("rejects an id that isn't a measure of the ingredient", () => {
    assert.throws(
      () => validMeasures([{ id: "other", name: "medium", amount: 1 }], [medium]),
      invalid("measures[0].id isn't a measure of this ingredient."),
    );
    assert.throws(
      () => validMeasures([{ id: "m1", name: "medium", amount: 1 }], []),
      invalid("measures[0].id isn't a measure of this ingredient."),
    );
  });

  test("rejects a repeated id", () => {
    assert.throws(
      () => validMeasures([medium, { ...medium, name: "other" }], [medium]),
      invalid("measures[1] repeats measure m1."),
    );
  });

  test("rejects a name that breaks a name rule, and names the entry", () => {
    const names = [
      ["", "measures[0]: The name can't be empty."],
      [7, 'measures[0]: "name" must be a string.'],
      ["x".repeat(101), "measures[0]: The name must be at most 100 characters."],
    ];
    for (const [name, message] of names) {
      assert.throws(
        () => validMeasures([{ name, amount: 1 }], []),
        invalid(message),
        String(name).slice(0, 20),
      );
    }
  });

  test("rejects two names that share a name key", () => {
    assert.throws(
      () =>
        validMeasures(
          [
            { name: "Mediana", amount: 1 },
            { name: "mediana", amount: 2 },
          ],
          [],
        ),
      invalid('measures[1] repeats the measure name "mediana".'),
    );
  });

  test("rejects an amount outside 0.01 to 10000, or with three decimals", () => {
    for (const amount of [0, 0.009, 10000.01, -1, 1.234, "5", null, Number.NaN]) {
      assert.throws(
        () => validMeasures([{ name: "medium", amount }], []),
        invalid(`measures[0].amount ${wrongQuantity}`),
        String(amount),
      );
    }
  });

  test("accepts the amount limits 0.01 and 10000", () => {
    for (const amount of [0.01, 10000]) {
      assert.equal(validMeasures([{ name: "medium", amount }], [])[0].amount, amount);
    }
  });

  test("cleans each name and rounds each amount to two decimals", () => {
    const [clean] = validMeasures([{ name: " big   medium ", amount: 0.1 + 0.2 }], []);

    assert.equal(clean.name, "big medium");
    assert.equal(clean.amount, 0.3);
  });

  test("keeps a given id, and gives a new id to an entry without one", () => {
    const clean = validMeasures(
      [
        { id: "m1", name: "tiny", amount: 70 },
        { name: "large", amount: 220 },
      ],
      [medium],
    );

    assert.deepEqual(clean[0], { id: "m1", name: "tiny", amount: 70 });
    assert.match(clean[1].id, UUID);
    assert.notEqual(clean[1].id, "m1");
  });

  test("accepts no measures, and returns an empty array", () => {
    assert.deepEqual(validMeasures([], [medium]), []);
  });
});

describe("validNewIngredient", () => {
  test("rejects fields that aren't a name and a unit, with optional measures", () => {
    const fields = [
      undefined,
      null,
      "Onion",
      [],
      {},
      { name: "Onion" },
      { unit: "g" },
      { name: "Onion", unit: "g", archived: false },
      { measures: [], name: "Onion" },
    ];
    for (const value of fields) {
      assert.throws(
        () => validNewIngredient(value),
        invalid('Send "name" and "unit", and optionally "measures".'),
        JSON.stringify(value),
      );
    }
  });

  test("rejects an invalid name", () => {
    assert.throws(
      () => validNewIngredient({ name: "", unit: "g" }),
      invalid("The name can't be empty."),
    );
    assert.throws(
      () => validNewIngredient({ name: 42, unit: "g" }),
      invalid('"name" must be a string.'),
    );
  });

  test("rejects an invalid unit", () => {
    for (const unit of ["kg", "G"]) {
      assert.throws(
        () => validNewIngredient({ name: "Onion", unit }),
        invalid('"unit" must be one of g, ml, pcs.'),
        unit,
      );
    }
  });

  test("rejects measures that aren't an array", () => {
    assert.throws(
      () => validNewIngredient({ name: "Leek", unit: "g", measures: null }),
      invalid('"measures" must be an array.'),
    );
  });

  test("rejects a measure that has an id", () => {
    assert.throws(
      () =>
        validNewIngredient({
          name: "Leek",
          unit: "g",
          measures: [{ id: "x", name: "a", amount: 1 }],
        }),
      invalid("measures[0].id isn't a measure of this ingredient."),
    );
  });

  test("returns the cleaned name, the unit, and no measures by default", () => {
    assert.deepEqual(validNewIngredient({ name: "  Red   onion ", unit: "g" }), {
      name: "Red onion",
      unit: "g",
      measures: [],
    });
  });

  test("returns the clean measures with new ids", () => {
    const valid = validNewIngredient({
      name: "Onion",
      unit: "g",
      measures: [{ name: " medium ", amount: 150 }],
    });

    assert.match(valid.measures[0].id, UUID);
    assert.deepEqual(valid.measures[0], { id: valid.measures[0].id, name: "medium", amount: 150 });
  });
});

describe("validConversion", () => {
  test("rejects a conversion with missing or extra keys", () => {
    const conversions = [
      null,
      "x",
      [],
      {},
      { from: 1 },
      { to: 120 },
      { from: 1, to: 120, color: "red" },
      { from: 1, to: 120, measureName: "piece", color: "red" },
    ];
    for (const conversion of conversions) {
      assert.throws(
        () => validConversion(conversion),
        invalid(wrongConversion),
        JSON.stringify(conversion),
      );
    }
  });

  test("rejects a from or to outside 0.01 to 10000, or with three decimals", () => {
    const conversions = [
      [{ from: 0, to: 120 }, "from"],
      [{ from: 1.234, to: 120 }, "from"],
      [{ from: "1", to: 120 }, "from"],
      [{ from: 1, to: 10000.01 }, "to"],
      [{ from: 1, to: 0.001 }, "to"],
      [{ from: 1, to: null }, "to"],
    ];
    for (const [conversion, field] of conversions) {
      assert.throws(
        () => validConversion(conversion),
        invalid(`conversion.${field} ${wrongQuantity}`),
        JSON.stringify(conversion),
      );
    }
  });

  test("rounds from and to, and keeps measureName as sent", () => {
    const clean = validConversion({ from: 0.1 * 3, to: 120, measureName: " piece " });

    assert.deepEqual(clean, { from: 0.3, to: 120, measureName: " piece " });
  });

  test("leaves measureName undefined when it isn't sent", () => {
    assert.equal(validConversion({ from: 1, to: 120 }).measureName, undefined);
  });
});

describe("validChanges", () => {
  const wrongKeys =
    'Send "name", "unit", "measures", "conversion", or any combination, or "archived" alone.';

  test("rejects a change that isn't a field list or archived alone", () => {
    const changes = [
      undefined,
      null,
      "Onion",
      [],
      {},
      { archived: true, name: "Leek" },
      { archived: true, unit: "g" },
      { color: "red" },
      { name: "Leek", color: "red" },
    ];
    for (const value of changes) {
      assert.throws(() => validChanges(value), invalid(wrongKeys), JSON.stringify(value));
    }
  });

  test("rejects archived that isn't true or false", () => {
    for (const archived of ["yes", null, 1]) {
      assert.throws(
        () => validChanges({ archived }),
        invalid('"archived" must be true or false.'),
        String(archived),
      );
    }
  });

  test("rejects an invalid unit", () => {
    assert.throws(() => validChanges({ unit: "kg" }), invalid('"unit" must be one of g, ml, pcs.'));
  });

  test("rejects an invalid name", () => {
    assert.throws(() => validChanges({ name: "" }), invalid("The name can't be empty."));
  });

  test("rejects measures that aren't an array", () => {
    for (const measures of [null, "medium", {}]) {
      assert.throws(
        () => validChanges({ measures }),
        invalid('"measures" must be an array.'),
        String(measures),
      );
    }
  });

  test("rejects an invalid conversion", () => {
    assert.throws(() => validChanges({ unit: "pcs", conversion: null }), invalid(wrongConversion));
    assert.throws(
      () => validChanges({ unit: "pcs", conversion: { from: 0, to: 120 } }),
      invalid(`conversion.from ${wrongQuantity}`),
    );
  });

  test("rejects a conversion without a unit", () => {
    assert.throws(
      () => validChanges({ conversion: { from: 1, to: 120 } }),
      invalid('Send "conversion" with a new "unit".'),
    );
    assert.throws(
      () => validChanges({ name: "Leek", conversion: { from: 1, to: 120 } }),
      invalid('Send "conversion" with a new "unit".'),
    );
  });

  test("rejects a conversion together with measures", () => {
    assert.throws(
      () => validChanges({ unit: "pcs", conversion: { from: 150, to: 1 }, measures: [medium] }),
      invalid('Send "conversion" and "measures" in separate changes.'),
    );
  });

  test("accepts archived alone", () => {
    assert.deepEqual(validChanges({ archived: true }), { archived: true });
    assert.deepEqual(validChanges({ archived: false }), { archived: false });
  });

  test("returns only the fields sent, with the name cleaned", () => {
    assert.deepEqual(validChanges({ name: " Red  onion " }), { name: "Red onion" });
    assert.deepEqual(validChanges({ name: "Milk", unit: "ml" }), { name: "Milk", unit: "ml" });
  });

  test("returns the measures as sent, because their ids are checked later", () => {
    const measures = [{ id: "x", name: "medium", amount: 1.234 }];

    assert.equal(validChanges({ measures }).measures, measures);
  });

  test("returns a clean conversion with a unit", () => {
    assert.deepEqual(
      validChanges({ unit: "g", conversion: { from: 1, to: 120, measureName: "x" } }),
      {
        unit: "g",
        conversion: { from: 1, to: 120, measureName: "x" },
      },
    );
  });
});

describe("convertedAmount", () => {
  const hint = "Change the recipes first.";

  // public/quantities.js converts the preview of the ingredient editor on
  // purpose with its own function, because the browser never imports from
  // server/. Both sides' tests read test/fixtures/converted-amounts.json, so
  // the preview shows the amount that the server saves.
  test("multiplies the amount by to ÷ from, rounded to two decimals", async () => {
    const cases = JSON.parse(
      await readFile(new URL("./fixtures/converted-amounts.json", import.meta.url), "utf8"),
    );
    for (const { amount, from, to, converted } of cases) {
      const measure = { name: "measure", amount };
      assert.equal(
        convertedAmount(measure, to / from, "g"),
        converted,
        `${amount} × ${to} ÷ ${from}`,
      );
    }
  });

  test("accepts an amount exactly at a limit despite binary floating point", () => {
    // 0.03 × (1 ÷ 3) is 0.009999999999999998 in binary floating point.
    assert.equal(convertedAmount({ name: "pinch", amount: 0.03 }, 1 / 3, "pcs"), 0.01);
    // 15 × (100 ÷ 0.15) is 10000.000000000002.
    assert.equal(convertedAmount({ name: "sack", amount: 15 }, 100 / 0.15, "g"), 10000);
  });

  test("rejects an amount below 0.01, even when it would round up to it", () => {
    // 1 ÷ 150 is 0.0067, which would round to the valid 0.01.
    assert.throws(
      () => convertedAmount({ name: "g", amount: 1 }, 1 / 150, "pcs"),
      invalid('"g" would be 0.006667 pcs, outside 0.01 to 10000.'),
    );
  });

  test("rejects an amount above 10000", () => {
    assert.throws(
      () => convertedAmount({ name: "bag", amount: 150 }, 100, "g"),
      invalid('"bag" would be 15000 g, outside 0.01 to 10000.'),
    );
  });

  test("shows the amount with 4 significant digits", () => {
    assert.throws(
      () => convertedAmount({ name: "pinch", amount: 0.5 }, 1 / 150, "pcs"),
      invalid('"pinch" would be 0.003333 pcs, outside 0.01 to 10000.'),
    );
  });

  test("adds the hint after the message of a rejected amount", () => {
    assert.throws(
      () => convertedAmount({ name: "g", amount: 1 }, 1 / 150, "pcs", hint),
      invalid(`"g" would be 0.006667 pcs, outside 0.01 to 10000. ${hint}`),
    );
  });
});

describe("missingConversion", () => {
  const onion = ingredient({ measures: [medium] });
  const saveFirst =
    'To change the unit of "Onion", save your measure changes first, and then change the unit.';
  const reload = '"Onion" has measures or recipes in g. Reload the page to change its unit.';

  test("returns a ValidationError without throwing it", () => {
    assert.ok(missingConversion(onion, undefined) instanceof ValidationError);
  });

  test("says to reload the page when the change sends no measures", () => {
    assert.equal(missingConversion(onion, undefined).message, reload);
  });

  test("says to save the measures first when none keeps a stored measure", () => {
    assert.equal(missingConversion(onion, []).message, saveFirst);
    assert.equal(
      missingConversion(onion, [{ id: "new", name: "large", amount: 2 }]).message,
      saveFirst,
    );
  });

  test("says to reload the page when a measure keeps a stored one", () => {
    // The editor loaded the ingredient before another tab changed its unit.
    assert.equal(missingConversion(onion, [medium]).message, reload);
    assert.equal(
      missingConversion(onion, [
        { ...medium, amount: 160 },
        { id: "new", name: "large", amount: 250 },
      ]).message,
      reload,
    );
  });

  test("names the ingredient and its current unit", () => {
    const egg = ingredient({ name: "Egg", unit: "pcs" });

    assert.equal(
      missingConversion(egg, undefined).message,
      '"Egg" has measures or recipes in pcs. Reload the page to change its unit.',
    );
  });
});

describe("unitMeasure", () => {
  const carrot = ingredient({ name: "Carrot", unit: "pcs" });

  test("requires a measureName", () => {
    assert.throws(
      () => unitMeasure(carrot, undefined),
      invalid(
        'A recipe has "Carrot" in pcs, so send conversion.measureName to name the measure that replaces it.',
      ),
    );
  });

  test("rejects a measureName that breaks a name rule, and names the field", () => {
    const names = [
      ["", "conversion.measureName: The name can't be empty."],
      ["   ", "conversion.measureName: The name can't be empty."],
      [7, 'conversion.measureName: "name" must be a string.'],
      ["x".repeat(101), "conversion.measureName: The name must be at most 100 characters."],
    ];
    for (const [measureName, message] of names) {
      assert.throws(
        () => unitMeasure(carrot, measureName),
        invalid(message),
        String(measureName).slice(0, 20),
      );
    }
  });

  test("rejects a measureName that matches a measure of another amount", () => {
    const withPieza = ingredient({
      name: "Carrot",
      unit: "pcs",
      measures: [{ id: "m1", name: "Pieza", amount: 1.01 }],
    });

    assert.throws(
      () => unitMeasure(withPieza, " PIEZA "),
      invalid('"Carrot" already has a measure named "Pieza".'),
    );
  });

  test("reuses the measure that has the name key and an amount of 1", () => {
    const pieza = { id: "m1", name: "Pieza", amount: 1 };
    const withPieza = ingredient({
      name: "Carrot",
      unit: "pcs",
      measures: [pieza, { id: "m2", name: "net", amount: 4 }],
    });

    assert.deepEqual(unitMeasure(withPieza, " PIEZA "), { target: pieza, added: false });
  });

  test("returns a new measure of 1 when no measure has the name key", () => {
    const { target, added } = unitMeasure(carrot, " big   piece ");

    assert.equal(added, true);
    assert.match(target.id, UUID);
    assert.deepEqual(target, { id: target.id, name: "big piece", amount: 1 });
  });

  test("rejects a new measure when the ingredient has 20 measures", () => {
    const full = ingredient({
      name: "Carrot",
      unit: "pcs",
      measures: Array.from({ length: 20 }, (_, index) => ({
        id: `m${index}`,
        name: `m${index}`,
        amount: 1,
      })),
    });

    assert.throws(
      () => unitMeasure(full, "piece"),
      invalid('"Carrot" already has 20 measures, so its unit can\'t become one.'),
    );
  });

  test("reuses a measure of 1 when the ingredient has 20 measures", () => {
    const full = ingredient({
      name: "Carrot",
      unit: "pcs",
      measures: Array.from({ length: 20 }, (_, index) => ({
        id: `m${index}`,
        name: `m${index}`,
        amount: 1,
      })),
    });

    assert.deepEqual(unitMeasure(full, "m0"), { target: full.measures[0], added: false });
  });
});

describe("normalizeMeasures", () => {
  test("returns no measures when the value isn't an array", () => {
    for (const raw of [undefined, null, "medium", {}, 7]) {
      assert.deepEqual(normalizeMeasures(raw), [], String(raw));
    }
  });

  test("drops the measures with a bad id, name, or amount", () => {
    const raw = [
      medium,
      { id: 5, name: "bad id", amount: 1 },
      { id: "m2", name: "", amount: 1 },
      { id: "m3", name: 7, amount: 1 },
      { id: "m4", name: "zero", amount: 0 },
      { id: "m5", name: "huge", amount: 10001 },
      { id: "m6", name: "decimals", amount: 1.234 },
      { id: "m7", name: "text", amount: "5" },
      { id: "m9", name: "Large", amount: 200.5 },
      null,
      "x",
    ];

    assert.deepEqual(normalizeMeasures(raw), [medium, { id: "m9", name: "Large", amount: 200.5 }]);
  });

  test("drops a measure that repeats an id or a name key", () => {
    const raw = [
      medium,
      { id: "m1", name: "repeated id", amount: 2 },
      { id: "m8", name: "MEDIUM", amount: 2 },
      { id: "m9", name: "Large", amount: 200.5 },
    ];

    assert.deepEqual(normalizeMeasures(raw), [medium, { id: "m9", name: "Large", amount: 200.5 }]);
  });

  test("keeps at most 20 measures, skipping invalid ones", () => {
    const valid = Array.from({ length: 25 }, (_, index) => ({
      id: `m${index}`,
      name: `size ${index}`,
      amount: index + 1,
    }));
    const mixed = valid.flatMap((measure, index) =>
      index % 5 === 0 ? [{ id: `bad${index}`, name: "", amount: 1 }, measure] : [measure],
    );

    assert.deepEqual(normalizeMeasures(mixed), valid.slice(0, 20));
  });

  test("cleans each name and rounds each amount", () => {
    assert.deepEqual(normalizeMeasures([{ id: "a", name: " big  one ", amount: 0.1 + 0.2 }]), [
      { id: "a", name: "big one", amount: 0.3 },
    ]);
  });
});

describe("normalize", () => {
  test("returns no ingredients when there is no file", () => {
    assert.deepEqual(normalize(undefined), []);
  });

  test("rejects data that isn't an object with an ingredients array", () => {
    const wrong = [[{ id: "a", name: "Onion", unit: "g" }], { ingredients: 1 }, null, "Onion", 7];
    for (const raw of wrong) {
      assert.throws(
        () => normalize(raw),
        { message: 'ingredients.json must be an object with an "ingredients" array.' },
        JSON.stringify(raw),
      );
    }
  });

  test("skips an entry without a string id and name, or with a bad unit", () => {
    const raw = {
      ingredients: [
        { id: "a", name: "Onion", unit: "g", archived: true },
        { id: "c", name: "Flour", unit: "kg" },
        { id: "d", name: "Salt" },
        { id: 5, name: "Bad ID", unit: "g" },
        { id: "e", name: 4, unit: "g" },
        null,
        "Milk",
      ],
    };

    assert.deepEqual(normalize(raw), [
      { id: "a", name: "Onion", unit: "g", measures: [], archived: true },
    ]);
  });

  test("reads archived as false unless it is true", () => {
    const raw = {
      ingredients: [
        { id: "a", name: "Onion", unit: "g" },
        { id: "b", name: "Egg", unit: "pcs", archived: "yes" },
        { id: "c", name: "Milk", unit: "ml", archived: true },
      ],
    };

    assert.deepEqual(
      normalize(raw).map((entry) => entry.archived),
      [false, false, true],
    );
  });

  test("normalizes the measures, and reads a missing list as empty", () => {
    const raw = {
      ingredients: [
        { id: "a", name: "Onion", unit: "g", measures: [medium, { id: "x", name: "", amount: 1 }] },
        { id: "b", name: "Egg", unit: "pcs" },
      ],
    };

    assert.deepEqual(normalize(raw), [
      { id: "a", name: "Onion", unit: "g", measures: [medium], archived: false },
      { id: "b", name: "Egg", unit: "pcs", measures: [], archived: false },
    ]);
  });
});

describe("changesUnit", () => {
  test("is true only for a unit other than the current one", () => {
    const onion = ingredient({ unit: "g" });

    assert.equal(changesUnit(onion, { unit: "pcs" }), true);
    assert.equal(changesUnit(onion, { unit: "g" }), false);
    assert.equal(changesUnit(onion, { name: "Leek" }), false);
    assert.equal(changesUnit(onion, {}), false);
  });
});

describe("unitChangeError", () => {
  const conversion = { from: 1, to: 120, measureName: "piece" };
  const noUsage = { inUnit: false, measureIds: new Set() };
  const unitLines = { inUnit: true, measureIds: new Set() };
  const withMeasures = ingredient({ measures: [medium] });
  const bare = ingredient({ name: "Milk" });

  test("returns nothing when the unit stays the same without a conversion", () => {
    assert.equal(unitChangeError(bare, {}, undefined, undefined), undefined);
    assert.equal(unitChangeError(bare, { name: "Whole milk" }, undefined, undefined), undefined);
    assert.equal(unitChangeError(bare, { unit: "g" }, undefined, noUsage), undefined);
  });

  test("rejects a conversion when the unit stays the same", () => {
    for (const fields of [{}, { name: "Whole milk" }, { unit: "g" }]) {
      const error = unitChangeError(withMeasures, fields, conversion, unitLines);

      assert.ok(error instanceof ValidationError, JSON.stringify(fields));
      assert.equal(error.message, 'Send "conversion" with a new "unit".');
    }
  });

  test("returns nothing when no measure or recipe needs the old unit", () => {
    assert.equal(unitChangeError(bare, { unit: "ml" }, undefined, noUsage), undefined);
  });

  test("rejects a conversion when no measure or recipe needs it", () => {
    const error = unitChangeError(bare, { unit: "ml" }, conversion, noUsage);

    assert.ok(error instanceof ValidationError);
    assert.equal(
      error.message,
      '"Milk" has no measures and no recipe uses its unit, so it needs no "conversion".',
    );
  });

  test("requires a conversion when the ingredient has measures", () => {
    const error = unitChangeError(withMeasures, { unit: "pcs" }, undefined, noUsage);

    assert.ok(error instanceof ValidationError);
    assert.equal(
      error.message,
      '"Onion" has measures or recipes in g. Reload the page to change its unit.',
    );
  });

  test("requires a conversion when a recipe has the ingredient in its unit", () => {
    const error = unitChangeError(bare, { unit: "ml" }, undefined, unitLines);

    assert.ok(error instanceof ValidationError);
    assert.equal(
      error.message,
      '"Milk" has measures or recipes in g. Reload the page to change its unit.',
    );
  });

  test("uses the measures of the change to say whether to save them first", () => {
    const error = unitChangeError(withMeasures, { unit: "pcs", measures: [] }, undefined, noUsage);

    assert.equal(
      error.message,
      'To change the unit of "Onion", save your measure changes first, and then change the unit.',
    );
  });

  test("returns nothing when a needed conversion comes with the change", () => {
    assert.equal(unitChangeError(withMeasures, { unit: "pcs" }, conversion, noUsage), undefined);
    assert.equal(unitChangeError(bare, { unit: "ml" }, conversion, unitLines), undefined);
  });
});

describe("planUnitChange", () => {
  const pieza = { id: "m1", name: "Pieza", amount: 1 };
  const net = { id: "m2", name: "net", amount: 4 };

  test("adds a measure of 1 for an ingredient in its unit", () => {
    const carrot = ingredient({ name: "Carrot", unit: "pcs", measures: [net] });

    const plan = planUnitChange(carrot, "g", { from: 1, to: 120, measureName: " piece " }, true);

    assert.equal(plan.added, true);
    assert.match(plan.target.id, UUID);
    assert.deepEqual(plan.target, { id: plan.target.id, name: "piece", amount: 1 });
  });

  test("multiplies every measure by to ÷ from, the new one included", () => {
    const carrot = ingredient({ name: "Carrot", unit: "pcs", measures: [net] });

    const plan = planUnitChange(carrot, "g", { from: 1, to: 120, measureName: " piece " }, true);

    assert.deepEqual(plan.measures, [
      { id: "m2", name: "net", amount: 480 },
      { id: plan.target.id, name: "piece", amount: 120 },
    ]);
  });

  test("converts the measures of 150 g = 1 pcs with the factor to ÷ from", () => {
    const onion = ingredient({
      measures: [medium, { id: "m3", name: "large", amount: 250 }],
    });

    const plan = planUnitChange(onion, "pcs", { from: 150, to: 1, measureName: undefined }, false);

    assert.equal(plan.target, undefined);
    assert.equal(plan.added, false);
    // 250 ÷ 150 is 1.666..., rounded to two decimals.
    assert.deepEqual(plan.measures, [
      { ...medium, amount: 1 },
      { id: "m3", name: "large", amount: 1.67 },
    ]);
  });

  test("ignores the measureName when no recipe has the ingredient in its unit", () => {
    const onion = ingredient({ measures: [medium] });

    const plan = planUnitChange(onion, "pcs", { from: 150, to: 1, measureName: "gram" }, false);

    assert.deepEqual(plan.measures, [{ ...medium, amount: 1 }]);
  });

  test("targets the measure with the name key and an amount of 1", () => {
    const carrot = ingredient({ name: "Carrot", unit: "pcs", measures: [pieza, net] });

    const plan = planUnitChange(carrot, "g", { from: 1, to: 120, measureName: " PIEZA " }, true);

    assert.equal(plan.added, false);
    assert.equal(plan.target, pieza);
    assert.deepEqual(plan.measures, [
      { ...pieza, amount: 120 },
      { ...net, amount: 480 },
    ]);
  });

  test("rejects an ingredient in its unit without a measureName", () => {
    const carrot = ingredient({ name: "Carrot", unit: "pcs" });

    assert.throws(
      () => planUnitChange(carrot, "g", { from: 1, to: 120, measureName: undefined }, true),
      invalid(
        'A recipe has "Carrot" in pcs, so send conversion.measureName to name the measure that replaces it.',
      ),
    );
  });

  test("adds the hint to the message for the new measure", () => {
    const onion = ingredient({ measures: [medium] });

    assert.throws(
      () => planUnitChange(onion, "pcs", { from: 150, to: 1, measureName: "g" }, true),
      invalid(
        '"g" would be 0.006667 pcs, outside 0.01 to 10000. To change the unit, first change the recipes that use "Onion" in g to a measure.',
      ),
    );
  });

  test("leaves the hint out of the message for a stored measure", () => {
    const salt = ingredient({ name: "Salt", measures: [{ id: "m4", name: "pinch", amount: 0.5 }] });

    assert.throws(
      () => planUnitChange(salt, "pcs", { from: 150, to: 1, measureName: undefined }, false),
      invalid('"pinch" would be 0.003333 pcs, outside 0.01 to 10000.'),
    );
  });

  test("doesn't change the ingredient", () => {
    const carrot = ingredient({ name: "Carrot", unit: "pcs", measures: [{ ...net }] });

    planUnitChange(carrot, "g", { from: 1, to: 120, measureName: "piece" }, true);

    assert.deepEqual(carrot, ingredient({ name: "Carrot", unit: "pcs", measures: [net] }));
  });
});

describe("removedMeasures", () => {
  const small = { id: "m2", name: "small", amount: 80 };
  const onion = ingredient({ measures: [medium, small] });

  test("lists the stored measures that the new list leaves out", () => {
    assert.deepEqual(removedMeasures(onion, [small]), [medium]);
    assert.deepEqual(removedMeasures(onion, []), [medium, small]);
  });

  test("lists nothing when the new list keeps every stored measure", () => {
    assert.deepEqual(removedMeasures(onion, [small, { ...medium, name: "big" }]), []);
  });

  test("counts a new measure with the same name as a removal of the old one", () => {
    assert.deepEqual(removedMeasures(onion, [{ id: "new", name: "medium", amount: 150 }, small]), [
      medium,
    ]);
  });
});

describe("removedMeasureInUse", () => {
  const small = { id: "m2", name: "small", amount: 80 };

  test("returns the first removed measure that a recipe uses", () => {
    assert.equal(removedMeasureInUse([medium, small], new Set(["m2", "m1"])), medium);
    assert.equal(removedMeasureInUse([medium, small], new Set(["m2"])), small);
  });

  test("returns nothing when no recipe uses a removed measure", () => {
    assert.equal(removedMeasureInUse([medium], new Set(["m2"])), undefined);
    assert.equal(removedMeasureInUse([], new Set(["m1"])), undefined);
  });
});

describe("withNewIngredient", () => {
  const onion = ingredient({ measures: [medium] });

  test("adds the ingredient with the ID and returns it", () => {
    const next = withNewIngredient([onion], { name: " Leek ", unit: "pcs" }, "i2");

    const leek = { id: "i2", name: "Leek", unit: "pcs", measures: [], archived: false };
    assert.deepEqual(next, { all: [onion, leek], ingredient: leek });
  });

  test("rejects fields that POST /api/ingredients rejects", () => {
    assert.throws(
      () => withNewIngredient([onion], { name: "Leek" }, "i2"),
      invalid('Send "name" and "unit", and optionally "measures".'),
    );
  });

  test("rejects a name whose name key another ingredient has", () => {
    assert.throws(() => withNewIngredient([onion], { name: "ONION", unit: "g" }, "i2"), {
      name: "NameConflictError",
      message: 'An ingredient named "Onion" already exists.',
      kind: "ingredient",
      entity: onion,
    });
  });

  test("doesn't change its arguments", () => {
    const all = [onion];
    const fields = { name: "Leek", unit: "pcs", measures: [{ name: "stalk", amount: 1 }] };
    const before = structuredClone({ all, fields });

    withNewIngredient(all, fields, "i2");

    assert.deepEqual({ all, fields }, before);
  });
});

describe("withIngredientChanges", () => {
  const small = { id: "m2", name: "small", amount: 80 };
  const onion = ingredient({ measures: [medium, small] });
  const leek = ingredient({ id: "i2", name: "Leek", unit: "pcs" });
  const unused = { inUnit: false, measureIds: new Set() };
  const unitInEditor = invalid("The unit of an ingredient changes in the ingredient editor.");

  test("applies the changes and returns the ingredient", () => {
    const next = withIngredientChanges([onion, leek], "i1", { name: "Red onion" }, unused);

    const renamed = { ...onion, name: "Red onion" };
    assert.deepEqual(next, { all: [renamed, leek], ingredient: renamed });
  });

  test("accepts the stored unit as no change", () => {
    const next = withIngredientChanges([onion], "i1", { name: "Onion", unit: "g" }, unused);

    assert.deepEqual(next.ingredient, onion);
  });

  test("rejects another unit", () => {
    assert.throws(() => withIngredientChanges([onion], "i1", { unit: "ml" }, unused), unitInEditor);
  });

  test("rejects a conversion, even with the stored unit", () => {
    for (const unit of ["g", "ml"]) {
      assert.throws(
        () =>
          withIngredientChanges(
            [onion],
            "i1",
            { unit, conversion: { from: 1, to: 1, measureName: "piece" } },
            unused,
          ),
        unitInEditor,
        unit,
      );
    }
  });

  test("rejects changes that PATCH /api/ingredients/:id rejects", () => {
    assert.throws(
      () => withIngredientChanges([onion], "i1", { color: "red" }, unused),
      invalid(
        'Send "name", "unit", "measures", "conversion", or any combination, or "archived" alone.',
      ),
    );
  });

  test("rejects an unknown ID", () => {
    assert.throws(() => withIngredientChanges([onion], "x", { archived: true }, unused), {
      name: "NotFoundError",
      message: "Unknown ingredient: x",
    });
  });

  test("rejects a name whose name key another ingredient has", () => {
    assert.throws(() => withIngredientChanges([onion, leek], "i2", { name: "onion" }, unused), {
      name: "NameConflictError",
      message: 'An ingredient named "Onion" already exists.',
      kind: "ingredient",
      entity: onion,
    });
  });

  test("removes a measure that no recipe uses", () => {
    const usage = { inUnit: true, measureIds: new Set(["m1"]) };

    const next = withIngredientChanges([onion], "i1", { measures: [medium] }, usage);

    assert.deepEqual(next.ingredient.measures, [medium]);
  });

  test("rejects removing a measure that a recipe uses", () => {
    const usage = { inUnit: false, measureIds: new Set(["m2"]) };

    assert.throws(() => withIngredientChanges([onion], "i1", { measures: [medium] }, usage), {
      name: "ConflictError",
      message: '"small" is used in recipes. To remove it, change those recipes first.',
    });
  });

  test("doesn't change its arguments", () => {
    const all = [onion, leek];
    const changes = { name: "Red onion", measures: [medium, { name: "big", amount: 300 }] };
    const usage = { inUnit: false, measureIds: new Set(["m1"]) };
    const before = structuredClone({ all, changes, usage });

    withIngredientChanges(all, "i1", changes, usage);

    assert.deepEqual({ all, changes, usage }, before);
  });
});
