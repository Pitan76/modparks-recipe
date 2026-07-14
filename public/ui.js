/**
 * mp-recipe CDN script
 * このスクリプトは ModParks 本体から読み込まれるUIコンポーネントや管理ツールです。
 */
console.log("Loaded mp-recipe management JS from CDN.");

window.ModParksRecipe = {
  version: "1.0.0",
  init: function(config) {
    console.log("ModParksRecipe initialized with config:", config);
    // TODO: 本体に注入するUIやレシピプレビューウィジェットの実装
  }
};
