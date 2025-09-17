// eslint.config.cjs
module.exports = [
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "commonjs",
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly"
      }
    },
    linterOptions: {
      reportUnusedDisableDirectives: true
    },
   rules: {
      // Possible errors
      "no-console": "off",           // allow console.log for CLI output
      "no-unused-vars": ["warn"],    // warn about unused variables
      "no-undef": "error",           // catch undefined variables
      "no-empty": "warn",            // warn about empty blocks
      "no-duplicate-case": "error",  // prevent duplicate case labels
      "no-fallthrough": "error",     // prevent fallthrough in switch

      // Best practices
      "eqeqeq": ["error", "always"], // enforce === and !==
      "curly": ["error", "all"],     // always use braces for blocks
      "no-var": "error",             // use let/const instead of var
      "prefer-const": "warn",        // prefer const if variable never changes
      "no-multi-spaces": "error",    // disallow multiple spaces
      "consistent-return": "warn",   // consistent function return style

      // Stylistic
      "semi": ["error", "always"],   // require semicolons
      "quotes": ["error", "double"], // use double quotes
      "indent": ["error", 2],        // 2 spaces indentation
      "comma-dangle": ["error", "never"], // no trailing commas
      "key-spacing": ["error", { "beforeColon": false, "afterColon": true }],
      "space-before-blocks": ["error", "always"],
      "brace-style": ["error", "1tbs", { "allowSingleLine": true }],

      // Node.js / CLI specific
      "no-process-exit": "off",      // allow process.exit() in CLI
    }
  }
];
