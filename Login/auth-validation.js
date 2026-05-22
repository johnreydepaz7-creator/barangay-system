(function () {
  'use strict';

  /* Login / auth pages always stay LIGHT mode.
     The dashboard stores the user's theme preference — we don't
     want that leaking back to the login / role-select screens. */
  function applyTheme() {
    document.documentElement.classList.remove('dark');
    if (document.body) document.body.classList.remove('dark');
  }

  applyTheme();
  document.addEventListener('DOMContentLoaded', applyTheme);

  function clearFieldError(field) {
    if (!field) return;
    const target = field.classList && field.classList.contains('phone-input') ? field.closest('.phone-wrap') || field : field;
    target.classList.remove('invalid-field');
    field.classList.remove('invalid-field');
    field.removeAttribute('aria-invalid');

    const group = field.closest('.form-group') || target.parentElement;
    if (group) {
      const error = group.querySelector('.field-error');
      if (error) error.remove();
    }
  }

  function setFieldError(field, message) {
    if (!field) return false;
    const target = field.classList && field.classList.contains('phone-input') ? field.closest('.phone-wrap') || field : field;
    target.classList.add('invalid-field');
    field.classList.add('invalid-field');
    field.setAttribute('aria-invalid', 'true');

    const group = field.closest('.form-group') || target.parentElement;
    if (group) {
      let error = group.querySelector('.field-error');
      if (!error) {
        error = document.createElement('div');
        error.className = 'field-error';
        group.appendChild(error);
      }
      error.textContent = message;
    }
    return false;
  }

  function getField(id) {
    return typeof id === 'string' ? document.getElementById(id) : id;
  }

  function validateRequired(id, label) {
    const field = getField(id);
    if (!field) return true;
    clearFieldError(field);
    if (!field.value.trim()) return setFieldError(field, `${label} is required.`);
    return true;
  }

  function validateName(id, label, required) {
    const field = getField(id);
    if (!field) return true;
    const value = field.value.trim().replace(/\s+/g, ' ');
    field.value = value;
    clearFieldError(field);

    if (!value) {
      return required ? setFieldError(field, `${label} is required.`) : true;
    }

    if (value.length < 2 || value.length > 60) {
      return setFieldError(field, `${label} must be 2 to 60 characters.`);
    }

    if (!/^[A-Za-zÀ-ÖØ-öø-ÿÑñ .'-]+$/.test(value)) {
      return setFieldError(field, `${label} can only contain letters, spaces, hyphens, apostrophes, and periods.`);
    }

    return true;
  }

  function validatePhone(id, label) {
    const field = getField(id);
    if (!field) return true;
    field.value = field.value.replace(/\D/g, '').slice(0, 10);
    clearFieldError(field);

    if (!field.value) return setFieldError(field, `${label || 'Phone number'} is required.`);
    if (!/^9\d{9}$/.test(field.value)) {
      return setFieldError(field, 'Enter a valid 10-digit Philippine mobile number starting with 9.');
    }
    return true;
  }

  function validateSelect(id, label) {
    const field = getField(id);
    if (!field) return true;
    clearFieldError(field);
    if (!field.value) return setFieldError(field, `${label} is required.`);
    return true;
  }

  function validateRecoveryCode(id) {
    const field = getField(id);
    if (!field) return true;
    field.value = field.value.trim().toUpperCase();
    clearFieldError(field);
    if (!field.value) return setFieldError(field, 'Recovery code is required.');
    if (!/^BRG59A-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(field.value)) {
      return setFieldError(field, 'Use the format BRG59A-XXXX-XXXX-XXXX.');
    }
    return true;
  }

  function validateOTP(inputs) {
    const fields = Array.from(inputs || document.querySelectorAll('.otp-input'));
    let ok = true;
    fields.forEach(field => {
      field.value = field.value.replace(/\D/g, '').slice(0, 1);
      clearFieldError(field);
      if (!field.value) {
        ok = false;
        field.classList.add('invalid-field');
        field.setAttribute('aria-invalid', 'true');
      }
    });
    return ok;
  }

  function wireLiveValidation() {
    document.querySelectorAll('.phone-input').forEach(field => {
      field.addEventListener('input', () => {
        field.value = field.value.replace(/\D/g, '').slice(0, 10);
        if (field.value.length === 10 && /^9\d{9}$/.test(field.value)) clearFieldError(field);
      });
    });

    document.querySelectorAll('.form-input, .form-select, .otp-input').forEach(field => {
      field.addEventListener('input', () => clearFieldError(field));
      field.addEventListener('change', () => clearFieldError(field));
    });
  }

  document.addEventListener('DOMContentLoaded', wireLiveValidation);

  window.BrgyAuthValidation = {
    applyTheme,
    clearFieldError,
    setFieldError,
    validateRequired,
    validateName,
    validatePhone,
    validateSelect,
    validateRecoveryCode,
    validateOTP
  };
})();
