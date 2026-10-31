// A small set of line icons, drawn here so the app needs no icon package.
const PATHS = {
  overview: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  brief: <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" />,
  code: (
    <>
      <circle cx="7" cy="5.5" r="2" />
      <circle cx="7" cy="18.5" r="2" />
      <circle cx="17" cy="8" r="2" />
      <path d="M7 7.5v9M17 10c0 4-10 2.500-10 6.500" />
    </>
  ),
  team: (
    <>
      <circle cx="9" cy="8" r="3.500" />
      <path d="M3 20c0-3.500 2.500-6 6-6s6 2.500 6 6M16 4.800a3.500 3.500 0 0 1 0 6.400M18 14.500c1.800.8 3 2.800 3 5.500" />
    </>
  ),
  agents: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <path d="M12 4v4M9.500 13v1.500M14.500 13v1.500" />
    </>
  ),
  messages: <path d="M4 5h16v11H10l-6 4z" />,
  settings: (
    <>
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    </>
  ),
  signout: <path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  switch: <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />,
  folder: <path d="M4 7h6l2 2h8v10H4z" />,
  file: <path d="M7 3h7l4 4v14H7zM14 3v4h4" />,
  check: <path d="M5 12l4.500 4.500L19 7" />,
};

export default function Icon({ name, className = 'size-[18px]' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`flex-none ${className}`}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
