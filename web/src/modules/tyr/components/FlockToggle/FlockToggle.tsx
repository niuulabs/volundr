import styles from './FlockToggle.module.css';

interface PersonaOption {
  name: string;
}

interface FlockToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  personas: PersonaOption[];
  selectedPersonas: string[];
  onPersonasChange: (personas: string[]) => void;
}

export function FlockToggle({
  enabled,
  onToggle,
  personas,
  selectedPersonas,
  onPersonasChange,
}: FlockToggleProps) {
  const togglePersona = (name: string) => {
    if (selectedPersonas.includes(name)) {
      onPersonasChange(selectedPersonas.filter(p => p !== name));
      return;
    }
    onPersonasChange([...selectedPersonas, name]);
  };

  return (
    <div className={styles.container}>
      <div className={styles.row}>
        <span className={styles.label}>Dispatch as flock</span>
        <button
          type="button"
          className={styles.toggle}
          role="switch"
          aria-label="Dispatch as flock"
          aria-checked={enabled}
          onClick={() => onToggle(!enabled)}
        >
          <span className={styles.toggleThumb} />
        </button>
      </div>
      {enabled && personas.length > 0 && (
        <div className={styles.personas}>
          <span className={styles.personasLabel}>Personas</span>
          <div className={styles.personaList}>
            {personas.map(p => (
              <button
                key={p.name}
                type="button"
                className={styles.personaChip}
                aria-pressed={selectedPersonas.includes(p.name)}
                onClick={() => togglePersona(p.name)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
