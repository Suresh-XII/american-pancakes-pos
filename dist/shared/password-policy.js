"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PASSWORD_POLICY_MESSAGE = exports.PASSWORD_MIN_LENGTH = void 0;
exports.validatePassword = validatePassword;
exports.PASSWORD_MIN_LENGTH = 4;
exports.PASSWORD_POLICY_MESSAGE = `Password must be at least ${exports.PASSWORD_MIN_LENGTH} characters long.`;
function validatePassword(password) {
    return typeof password === 'string' && password.length >= exports.PASSWORD_MIN_LENGTH;
}
//# sourceMappingURL=password-policy.js.map