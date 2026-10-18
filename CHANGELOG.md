# Changelog

## [0.3.0](https://github.com/ruy-ggarcia/meals/compare/v0.2.0...v0.3.0) (2026-10-18)


### Features

* measure ingredients in named measures ([03fc05b](https://github.com/ruy-ggarcia/meals/commit/03fc05b4826b8eb5381ce3cbfacd6817c7a026cf))
* **server:** add measures to ingredients ([701a8db](https://github.com/ruy-ggarcia/meals/commit/701a8db6230581b6ac01785ea154f5e2422ebe84))
* **server:** change the unit of an ingredient in use with a conversion ([1e622bf](https://github.com/ruy-ggarcia/meals/commit/1e622bf3b6b8935ffc264292bf110928be27d1b3))
* **server:** measure recipe ingredients in a measure ([a070b37](https://github.com/ruy-ggarcia/meals/commit/a070b371f191337526016c2ecf7eeb342fa51911))
* **ui:** add ingredients in the ingredient editor ([aee93e2](https://github.com/ruy-ggarcia/meals/commit/aee93e22c74d9764723a8843c2109ec48c52ae4a))
* **ui:** change the unit of an ingredient with a conversion ([c2d3616](https://github.com/ruy-ggarcia/meals/commit/c2d361622d275e38161e6819acab7baab918ac26))
* **ui:** convert measures and show kilograms and liters in the shopping list ([d8e650b](https://github.com/ruy-ggarcia/meals/commit/d8e650b33ca5b74323f65055c4cd3faef154d047))
* **ui:** edit the measures of an ingredient ([a705f15](https://github.com/ruy-ggarcia/meals/commit/a705f15d650313d45062ad32a50985d6c36c7fe5))
* **ui:** measure recipe ingredients in a measure ([3337f35](https://github.com/ruy-ggarcia/meals/commit/3337f35eee73887969c5c4458445cdf24f52f1ab))


### Bug Fixes

* **deps:** bump express ([00e0ac0](https://github.com/ruy-ggarcia/meals/commit/00e0ac01f3b5cab24b3cf1bd51c25313cafff324))
* **deps:** bump express from 5.2.1 to 5.3.0 in the npm-production group across 1 directory ([55bb0aa](https://github.com/ruy-ggarcia/meals/commit/55bb0aa54041abcac98445913078cc76bdf57809))
* **ui:** clear row errors as you type and keep focus on Done ([45f24df](https://github.com/ruy-ggarcia/meals/commit/45f24df0bf03ae6f6a49d5ef705dc44323acf4f0))
* **ui:** load the latest recipes and ingredients before editing ([056cf24](https://github.com/ruy-ggarcia/meals/commit/056cf24401a736289f58bef2879e4545147c0e17))
* **ui:** wrap long amounts in the shopping list ([1d2b6ff](https://github.com/ruy-ggarcia/meals/commit/1d2b6ff394b52b54407ad63b4ad795e19468c70e))

## [0.2.0](https://github.com/ruy-ggarcia/meals/compare/v0.1.0...v0.2.0) (2026-10-18)


### Features

* **api:** serve the recipe book and menus ([0fb6737](https://github.com/ruy-ggarcia/meals/commit/0fb6737bf235977d77894876fbfb23172065719d))
* **host:** back up the data with a version and a retention ([63ac383](https://github.com/ruy-ggarcia/meals/commit/63ac383f9d6acc04a3d810a9a6b004d5a5555f1b))
* **host:** check every week that the latest backup restores ([43f5304](https://github.com/ruy-ggarcia/meals/commit/43f5304b0d63e29dea14ef801298c837d8a1b92f))
* **host:** deploy releases with a backup, a verification, and a rollback ([2fa6ac5](https://github.com/ruy-ggarcia/meals/commit/2fa6ac546cda2d5da9aa9460e46fdcc9d10a378b))
* **host:** install the host tools and their systemd timers ([85f4632](https://github.com/ruy-ggarcia/meals/commit/85f4632f06462cd1c760a61a128e6244b30c3dbe))
* **host:** restore a validated backup ([c0045a8](https://github.com/ruy-ggarcia/meals/commit/c0045a8cfa92e8c461d220bdcada011234cbe54b))
* **server:** add ingredients to recipes ([7249f81](https://github.com/ruy-ggarcia/meals/commit/7249f81fe5c23ed8d95fb58d661d949d135baa37))
* **server:** add the health endpoint ([0f519fa](https://github.com/ruy-ggarcia/meals/commit/0f519fa39d964cc978fc73cb9d814c2c92dd3aaa))
* **server:** add the ingredient catalog store ([c2ff614](https://github.com/ruy-ggarcia/meals/commit/c2ff61471354b305cfb428eac13f6a6fa35cf4b7))
* **server:** add the ingredients API ([eeb374c](https://github.com/ruy-ggarcia/meals/commit/eeb374ccda6dde93efa7f8b46649c86be6e3a764))
* **server:** log requests and errors as JSON lines ([ab37a37](https://github.com/ruy-ggarcia/meals/commit/ab37a37283d5f94bf5038755ea4e305ec96b0580))
* **server:** stop cleanly on SIGINT and SIGTERM ([e33d2f7](https://github.com/ruy-ggarcia/meals/commit/e33d2f793df3f6926f09567fe1f1256041578785))
* **store:** add JSON helpers and a write queue ([0cba4a9](https://github.com/ruy-ggarcia/meals/commit/0cba4a9a047cc0c0558d18275b47f86988a87966))
* **store:** add the recipe book ([18c07c7](https://github.com/ruy-ggarcia/meals/commit/18c07c70b98bdf8ffa855ac497372a425e1cc8c3))
* **store:** store a menu in each slot of a week ([1e0d51c](https://github.com/ruy-ggarcia/meals/commit/1e0d51cce49e19a35a4394df7463a1ec6e22e6d4))
* **ui:** add menu, recipe name, and HTTP helpers ([07949d1](https://github.com/ruy-ggarcia/meals/commit/07949d19240192a7876c1597387a98b735a7ff65))
* **ui:** add quantity parsing and exact arithmetic ([1d08f38](https://github.com/ruy-ggarcia/meals/commit/1d08f38b0f29d7c63e509bbc4e05d26ff6d1b0ee))
* **ui:** add the ingredient editor ([4265236](https://github.com/ruy-ggarcia/meals/commit/42652363ea0e92dfc39a90403f02ac28d5c8a7a7))
* **ui:** add the Ingredients page and link the pages ([f594800](https://github.com/ruy-ggarcia/meals/commit/f59480055f51174ad6fe9fb83da3619b0ca65cfe))
* **ui:** add the recipe book page ([e8e0851](https://github.com/ruy-ggarcia/meals/commit/e8e0851289a35ff70332f9ed49ad3dd2aa7ef078))
* **ui:** add the recipe editor ([443be8e](https://github.com/ruy-ggarcia/meals/commit/443be8e1895696461a48253e6521897ec5013380))
* **ui:** compute the shopping list of a week ([2c69b4b](https://github.com/ruy-ggarcia/meals/commit/2c69b4b24fd4f8b2e1f2c6779e8b2cdbd8bd369c))
* **ui:** edit recipes and their ingredients in a dialog ([e9f33c3](https://github.com/ruy-ggarcia/meals/commit/e9f33c3eb89ba1c0d2bf0839c6d8d27ca7135cfe))
* **ui:** edit the menu of a slot in a dialog ([b6bfda7](https://github.com/ruy-ggarcia/meals/commit/b6bfda7e43d23c1ec3e608aea401f0d0f83cbd0b))
* **ui:** save menus instead of text ([f1dd5fa](https://github.com/ruy-ggarcia/meals/commit/f1dd5fa54dd946cfa8fcfad6c92ceb84867bfcd1))
* **ui:** show menus in the grid ([a62fe0c](https://github.com/ruy-ggarcia/meals/commit/a62fe0cc51a74ca28b8c630fa83c95adeb0185ac))
* **ui:** show the shopping list of the week ([b77d505](https://github.com/ruy-ggarcia/meals/commit/b77d505d42eefd9a2520a45e4e34069755964828))


### Bug Fixes

* **ui:** make the save error hint device-neutral ([f1e878b](https://github.com/ruy-ggarcia/meals/commit/f1e878b461ad02115546f947cecaf89a4c0fc103))
* **ui:** never save a slot that wasn't loaded ([672be9e](https://github.com/ruy-ggarcia/meals/commit/672be9ea74ea5a21ec251e4568076f73f61352a8))
* **ui:** use the page's timers for the saved check mark ([2daf6dd](https://github.com/ruy-ggarcia/meals/commit/2daf6dd927b78f1a19de686eb9d58d9eca986ba7))

## 0.1.0 (2026-09-26)

Initial release. Meals is a self-hosted weekly meal planner: a grid of 7
days by 5 meals, shared by every desktop and mobile browser on the network.

### Features

* Plan any week, past or future, with previous, next, and Today controls.
* Keep the displayed week in the URL, show the dates in the day headers, and
  mark today.
* Save each slot when you leave it, change days or weeks, or hide the page,
  and show its save status. Changing weeks never discards unsaved text
  without asking.
* Store each week in its own JSON file under `data/weeks/`, written
  atomically.
