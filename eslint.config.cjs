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
      "no-console": "off",          
      "no-unused-vars": ["warn"],    
      "no-undef": "error",           
      "no-empty": "warn",            
      "no-duplicate-case": "error",  
      "no-fallthrough": "error",     

      // Best practices
      "eqeqeq": ["error", "always"], 
      "curly": ["error", "all"],    
      "no-var": "error",             
      "prefer-const": "warn",        
      "no-multi-spaces": "error",    
      "consistent-return": "warn",  

      "no-process-exit": "off",      
    }
  }
];
