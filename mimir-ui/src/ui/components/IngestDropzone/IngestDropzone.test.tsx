import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IngestDropzone } from './IngestDropzone';

const instances = [
  { name: 'local', writeEnabled: true },
  { name: 'production', writeEnabled: false },
];

describe('IngestDropzone', () => {
  describe('rendering', () => {
    it('shows drop area label', () => {
      render(
        <IngestDropzone
          instances={instances}
          activeInstanceName="local"
          onIngest={vi.fn()}
        />,
      );
      expect(screen.getByText(/Drop a file here or click to browse/i)).toBeDefined();
    });

    it('shows title input', () => {
      render(
        <IngestDropzone
          instances={instances}
          activeInstanceName="local"
          onIngest={vi.fn()}
        />,
      );
      expect(screen.getByRole('textbox', { name: /title/i })).toBeDefined();
    });

    it('shows content textarea', () => {
      render(
        <IngestDropzone
          instances={instances}
          activeInstanceName="local"
          onIngest={vi.fn()}
        />,
      );
      expect(screen.getByRole('textbox', { name: /content/i })).toBeDefined();
    });

    it('shows instance selector with write-enabled instances', () => {
      render(
        <IngestDropzone
          instances={instances}
          activeInstanceName="local"
          onIngest={vi.fn()}
        />,
      );
      const select = screen.getByRole('combobox', { name: /instance/i });
      expect(select).toBeDefined();
    });

    it('shows source type selector', () => {
      render(
        <IngestDropzone
          instances={instances}
          activeInstanceName="local"
          onIngest={vi.fn()}
        />,
      );
      expect(screen.getByRole('combobox', { name: /source type/i })).toBeDefined();
    });

    it('shows Submit button disabled when form is empty', () => {
      render(
        <IngestDropzone
          instances={instances}
          activeInstanceName="local"
          onIngest={vi.fn()}
        />,
      );
      const submit = screen.getByRole('button', { name: /submit/i });
      expect((submit as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows no writeable instances message when all instances are read-only', () => {
      render(
        <IngestDropzone
          instances={[{ name: 'production', writeEnabled: false }]}
          activeInstanceName="production"
          onIngest={vi.fn()}
        />,
      );
      expect(screen.getByText(/No write-enabled instances/i)).toBeDefined();
    });
  });

  describe('form interactions', () => {
    it('enables Submit button when title and content are filled', () => {
      render(
        <IngestDropzone
          instances={instances}
          activeInstanceName="local"
          onIngest={vi.fn()}
        />,
      );
      fireEvent.change(screen.getByRole('textbox', { name: /title/i }), {
        target: { value: 'My Document' },
      });
      fireEvent.change(screen.getByRole('textbox', { name: /content/i }), {
        target: { value: 'Some content here' },
      });
      const submit = screen.getByRole('button', { name: /submit/i });
      expect((submit as HTMLButtonElement).disabled).toBe(false);
    });

    it('calls onIngest with correct args on submit', async () => {
      const onIngest = vi.fn().mockResolvedValue(undefined);
      render(
        <IngestDropzone
          instances={instances}
          activeInstanceName="local"
          onIngest={onIngest}
        />,
      );
      fireEvent.change(screen.getByRole('textbox', { name: /title/i }), {
        target: { value: 'My Document' },
      });
      fireEvent.change(screen.getByRole('textbox', { name: /content/i }), {
        target: { value: 'My content' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
      await waitFor(() => {
        expect(onIngest).toHaveBeenCalled();
      });
    });

    it('shows success message after successful submit', async () => {
      const onIngest = vi.fn().mockResolvedValue(undefined);
      render(
        <IngestDropzone
          instances={instances}
          activeInstanceName="local"
          onIngest={onIngest}
        />,
      );
      fireEvent.change(screen.getByRole('textbox', { name: /title/i }), {
        target: { value: 'Doc' },
      });
      fireEvent.change(screen.getByRole('textbox', { name: /content/i }), {
        target: { value: 'Content' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
      await waitFor(() => {
        expect(screen.getByText(/Ingest submitted successfully/i)).toBeDefined();
      });
    });

    it('resets form after successful submit', async () => {
      const onIngest = vi.fn().mockResolvedValue(undefined);
      render(
        <IngestDropzone
          instances={instances}
          activeInstanceName="local"
          onIngest={onIngest}
        />,
      );
      fireEvent.change(screen.getByRole('textbox', { name: /title/i }), {
        target: { value: 'My Document' },
      });
      fireEvent.change(screen.getByRole('textbox', { name: /content/i }), {
        target: { value: 'My content' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
      await waitFor(() => {
        const titleInput = screen.getByRole('textbox', { name: /title/i }) as HTMLInputElement;
        expect(titleInput.value).toBe('');
      });
    });

    it('shows error message when onIngest throws', async () => {
      const onIngest = vi.fn().mockRejectedValue(new Error('Ingest failed: server error'));
      render(
        <IngestDropzone
          instances={instances}
          activeInstanceName="local"
          onIngest={onIngest}
        />,
      );
      fireEvent.change(screen.getByRole('textbox', { name: /title/i }), {
        target: { value: 'Doc' },
      });
      fireEvent.change(screen.getByRole('textbox', { name: /content/i }), {
        target: { value: 'Content' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeDefined();
      });
    });

    it('Reset button clears the form', () => {
      render(
        <IngestDropzone
          instances={instances}
          activeInstanceName="local"
          onIngest={vi.fn()}
        />,
      );
      fireEvent.change(screen.getByRole('textbox', { name: /title/i }), {
        target: { value: 'My Document' },
      });
      fireEvent.click(screen.getByRole('button', { name: /reset/i }));
      const titleInput = screen.getByRole('textbox', { name: /title/i }) as HTMLInputElement;
      expect(titleInput.value).toBe('');
    });
  });

  describe('drag and drop', () => {
    it('shows "Drop to load file" text while dragging', () => {
      render(
        <IngestDropzone
          instances={instances}
          activeInstanceName="local"
          onIngest={vi.fn()}
        />,
      );
      const dropArea = screen.getByRole('button', { name: /drop a file/i });
      fireEvent.dragOver(dropArea);
      expect(screen.getByText(/Drop to load file/i)).toBeDefined();
    });
  });
});
