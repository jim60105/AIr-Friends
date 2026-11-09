// Ambient declarations for runtime-only npm packages whose deep entrypoints
// ship no type declarations (the Deno-era tree type-checked them through JSR).
declare module "mailparser";
declare module "html-to-text";
declare module "nodemailer/lib/mail-composer/index.js";
declare module "nodemailer/lib/smtp-connection/index.js";
