// Same rules as the original page, plus the backend's code formats.
export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

export function validateAuth({ mode, name, email, password }) {
  const errors = {};
  if (mode === 'signup' && name.trim().length < 2) errors.name = 'Enter your full name.';
  if (!isEmail(email)) errors.email = 'Enter an email like you@company.com.';
  if (mode !== 'forgot') {
    if (password.length < 8) errors.password = 'Use at least 8 characters.';
    else if (mode === 'signup' && !/\d/.test(password)) errors.password = 'Add at least one number.';
  }
  return errors;
}

export function validateNewPassword(password, confirm) {
  const errors = {};
  if (password.length < 8) errors.password = 'Use at least 8 characters.';
  else if (!/\d/.test(password)) errors.password = 'Add at least one number.';
  if (!errors.password && password !== confirm) errors.confirm = 'The passwords do not match.';
  return errors;
}

// Admin codes look like ADM-7K2QXM9P, observer codes like OBS-7K2QXM9P.
export const isProjectCode = (v) => /^(ADM|OBS)-[A-Z0-9]{8}$/i.test(v.trim());
