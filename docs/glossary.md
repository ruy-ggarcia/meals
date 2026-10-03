# Glossary

Each concept has one name in the code, the API, the stored data, the user
interface, and the documentation. Don't use synonyms, such as *cell* for
*slot* or *dish* for *recipe*.

| Term | Definition |
|------|------------|
| Active ingredient | An ingredient that isn't archived. Only active ingredients can be added to a recipe. |
| Active recipe | A recipe that isn't archived. Only active recipes can be added to a menu. |
| Archived ingredient | An ingredient that's as if it didn't exist when you add ingredients to a recipe: it isn't offered, but it stays in the recipes that already use it. You can restore it. |
| Archived recipe | A recipe that's as if it didn't exist when you add recipes to a menu: it isn't offered, but it stays in the menus that already use it. You can restore it. |
| Day | One of the seven days of a week: `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, or `sun`. |
| Ingredient | Something you buy and use in recipes. The ingredient catalog holds it with a stable ID, a unique name, and a unit. In a recipe, it has a quantity. |
| Ingredient catalog | All the ingredients, active and archived. |
| Meal | One of the five times of day: `breakfast`, `snack_am`, `lunch`, `snack_pm`, or `dinner`. |
| Meal plan | All the saved weeks. |
| Menu | The content of a slot: an ordered list of menu items, possibly empty. |
| Menu item | A recipe in a menu, with its servings. |
| Name key | The form of a recipe or ingredient name that decides uniqueness and order: without accents and in lowercase. `Café` and `cafe` have the same name key. |
| Quantity | How much of an ingredient one serving of a recipe needs, in the ingredient's unit: a number from 0.01 to 10000 with at most two decimals. |
| Recipe | An entry of the recipe book, with a stable ID and a unique name. |
| Recipe book | All the recipes, active and archived. |
| Servings | How many servings of a recipe a menu item has: a multiple of 0.5 from 0.5 to 99. |
| Shopping list | For the displayed week, each ingredient with the sum of quantity × servings over every menu item, rounded up to a whole number. |
| Slot | The meeting point of a day and a meal in a week. It holds a menu. |
| Unit | How an ingredient is measured: `g`, `ml`, or `pcs`. |
| Week | Seven days from Monday to Sunday, identified by the date of its Monday as `YYYY-MM-DD`. |
