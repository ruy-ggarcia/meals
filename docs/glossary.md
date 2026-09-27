# Glossary

Each concept has one name in the code, the API, the stored data, the user
interface, and the documentation. Don't use synonyms, such as *cell* for
*slot* or *dish* for *recipe*.

| Term | Definition |
|------|------------|
| Active recipe | A recipe that isn't archived. Only active recipes can be added to a menu. |
| Archived recipe | A recipe that's as if it didn't exist when you add recipes to a menu: it isn't offered, but it stays in the menus that already use it. You can restore it. |
| Day | One of the seven days of a week: `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, or `sun`. |
| Meal | One of the five times of day: `breakfast`, `snack_am`, `lunch`, `snack_pm`, or `dinner`. |
| Meal plan | All the saved weeks. |
| Menu | The content of a slot: an ordered list of menu items, possibly empty. |
| Menu item | A recipe in a menu, with its servings. |
| Name key | The form of a recipe name that decides uniqueness and order: without accents and in lowercase. `Café` and `cafe` have the same name key. |
| Recipe | An entry of the recipe book, with a stable ID and a unique name. |
| Recipe book | All the recipes, active and archived. |
| Servings | How many servings of a recipe a menu item has: a multiple of 0.5 from 0.5 to 99. |
| Slot | The meeting point of a day and a meal in a week. It holds a menu. |
| Week | Seven days from Monday to Sunday, identified by the date of its Monday as `YYYY-MM-DD`. |
