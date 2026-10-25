import React, { useState } from 'react';

interface PersonaSwitcherProps {
  currentUsername?: string;
  onSwitch: (username: string) => Promise<void>;
}

const DEMO_PERSONAS = [
  { username: 'admin', label: 'ADMIN', color: '#F59E0B', badge: 'OPERATOR' },
  { username: 'alice', label: 'ALICE', color: '#00F0FF', badge: 'TRADER' },
  { username: 'bob', label: 'BOB', color: '#10B981', badge: 'MAKER' },
  { username: 'carol', label: 'CAROL', color: '#A855F7', badge: 'TAKER' },
];

export const PersonaSwitcher: React.FC<PersonaSwitcherProps> = ({
  currentUsername,
  onSwitch,
}) => {
  const [switching, setSwitching] = useState<string | null>(null);

  const handleClick = async (username: string) => {
    if (currentUsername === username || switching) return;
    setSwitching(username);
    try {
      await onSwitch(username);
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(15, 23, 42, 0.7)',
        border: '1px solid #1E293B',
        borderRadius: 20,
        padding: '2px 4px',
        gap: 3,
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: '#64748B',
          padding: '0 6px',
          letterSpacing: 0.5,
        }}
      >
        PERSONA:
      </span>
      {DEMO_PERSONAS.map((p) => {
        const isActive = currentUsername?.toLowerCase() === p.username;
        const isThisSwitching = switching === p.username;

        return (
          <button
            key={p.username}
            onClick={() => handleClick(p.username)}
            disabled={isActive || !!switching}
            style={{
              background: isActive
                ? p.color
                : 'transparent',
              color: isActive ? '#06080F' : '#94A3B8',
              border: 'none',
              borderRadius: 14,
              padding: '3px 9px',
              fontSize: 10,
              fontWeight: 700,
              cursor: isActive ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              transition: 'all 0.15s ease',
              fontFamily: '"JetBrains Mono", monospace',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: isActive ? '#06080F' : p.color,
                display: 'inline-block',
              }}
            />
            {isThisSwitching ? '...' : p.label}
          </button>
        );
      })}
    </div>
  );
};
