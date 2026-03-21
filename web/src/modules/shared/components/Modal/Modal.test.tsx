import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './Modal';

describe('Modal', () => {
  it('renders when isOpen is true', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} title="Test Modal">
        <p>Modal content</p>
      </Modal>
    );

    expect(screen.getByText('Test Modal')).toBeInTheDocument();
    expect(screen.getByText('Modal content')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(
      <Modal isOpen={false} onClose={() => {}} title="Test Modal">
        <p>Modal content</p>
      </Modal>
    );

    expect(screen.queryByText('Test Modal')).not.toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} title="Title" subtitle="Subtitle text">
        <p>Content</p>
      </Modal>
    );

    expect(screen.getByText('Subtitle text')).toBeInTheDocument();
  });

  it('does not render subtitle when not provided', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Title">
        <p>Content</p>
      </Modal>
    );

    const subtitleElement = container.querySelector('[class*="subtitle"]');
    expect(subtitleElement).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const handleClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={handleClose} title="Test">
        <p>Content</p>
      </Modal>
    );

    const closeButton = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeButton);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const handleClose = vi.fn();
    const { container } = render(
      <Modal isOpen={true} onClose={handleClose} title="Test">
        <p>Content</p>
      </Modal>
    );

    const backdrop = container.querySelector('[class*="backdrop"]');
    if (backdrop) {
      fireEvent.click(backdrop);
    }

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('renders with default lg size', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Test">
        <p>Content</p>
      </Modal>
    );

    const modal = container.querySelector('[class*="modal"]') as HTMLElement;
    expect(modal?.className).toMatch(/lg/);
  });

  it('renders with sm size', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Test" size="sm">
        <p>Content</p>
      </Modal>
    );

    const modal = container.querySelector('[class*="modal"]') as HTMLElement;
    expect(modal?.className).toMatch(/sm/);
  });

  it('renders with md size', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Test" size="md">
        <p>Content</p>
      </Modal>
    );

    const modal = container.querySelector('[class*="modal"]') as HTMLElement;
    expect(modal?.className).toMatch(/md/);
  });

  it('renders with xl size', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Test" size="xl">
        <p>Content</p>
      </Modal>
    );

    const modal = container.querySelector('[class*="modal"]') as HTMLElement;
    expect(modal?.className).toMatch(/xl/);
  });

  it('renders complex children', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} title="Test">
        <div>
          <h3>Section 1</h3>
          <p>Paragraph text</p>
        </div>
        <div>
          <h3>Section 2</h3>
          <ul>
            <li>Item 1</li>
            <li>Item 2</li>
          </ul>
        </div>
      </Modal>
    );

    expect(screen.getByText('Section 1')).toBeInTheDocument();
    expect(screen.getByText('Section 2')).toBeInTheDocument();
    expect(screen.getByText('Item 1')).toBeInTheDocument();
  });
});
