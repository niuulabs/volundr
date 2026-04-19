import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { OutcomeCard, parseOutcomeFields, OUTCOME_RE, OUTCOME_EXTRACT_RE } from './OutcomeCard';

vi.mock('./OutcomeCard.module.css', () => ({ default: {} }));

describe('parseOutcomeFields', () => {
  it('parses multi-line YAML-style fields', () => {
    const raw = 'verdict: pass\nreason: All tests passed\nconfidence: 0.9';
    const fields = parseOutcomeFields(raw);
    expect(fields['verdict']).toBe('pass');
    expect(fields['reason']).toBe('All tests passed');
    expect(fields['confidence']).toBe('0.9');
  });

  it('skips lines starting with #', () => {
    const raw = '# comment\nverdict: fail';
    const fields = parseOutcomeFields(raw);
    expect(fields['verdict']).toBe('fail');
    expect(Object.keys(fields)).not.toContain('#');
  });

  it('parses single-line inline format', () => {
    const raw = 'verdict: pass reason: looks good';
    const fields = parseOutcomeFields(raw);
    expect(fields['verdict']).toBeDefined();
  });

  it('returns empty object for empty string', () => {
    const fields = parseOutcomeFields('');
    expect(Object.keys(fields)).toHaveLength(0);
  });

  it('skips lines without colon separator', () => {
    const raw = 'no-colon\nverdict: pass';
    const fields = parseOutcomeFields(raw);
    expect(fields['verdict']).toBe('pass');
  });
});

describe('OUTCOME_RE', () => {
  it('matches ---outcome--- blocks ending with ---end---', () => {
    const text = 'before\n---outcome---\nverdict: pass\n---end---\nafter';
    OUTCOME_RE.lastIndex = 0;
    const match = OUTCOME_RE.exec(text);
    expect(match).not.toBeNull();
    expect(match![0]).toContain('---outcome---');
  });

  it('matches ---outcome--- blocks ending with standalone ---', () => {
    const text = '---outcome---\nverdict: fail\n---\nafter';
    OUTCOME_RE.lastIndex = 0;
    const match = OUTCOME_RE.exec(text);
    expect(match).not.toBeNull();
  });

  it('does not match plain text without markers', () => {
    OUTCOME_RE.lastIndex = 0;
    const match = OUTCOME_RE.exec('just plain text here');
    expect(match).toBeNull();
  });
});

describe('OUTCOME_EXTRACT_RE', () => {
  it('extracts YAML content between ---outcome--- and ---end---', () => {
    const block = '---outcome---\nverdict: pass\nreason: ok\n---end---';
    const match = block.match(OUTCOME_EXTRACT_RE);
    expect(match).not.toBeNull();
    expect(match![1]).toContain('verdict: pass');
  });
});

describe('OutcomeCard', () => {
  it('renders with a known verdict and shows it as badge text', () => {
    render(<OutcomeCard yaml={"verdict: pass\nreason: All good"} />);
    expect(screen.getByText('pass')).toBeInTheDocument();
  });

  it('sets data-verdict attribute to "unknown" for unknown verdict', () => {
    render(<OutcomeCard yaml="verdict: maybe" />);
    const badge = screen.getByText('maybe');
    expect(badge).toHaveAttribute('data-verdict', 'unknown');
  });

  it('sets data-verdict attribute to the verdict value for known verdicts', () => {
    render(<OutcomeCard yaml="verdict: approve" />);
    const badge = screen.getByText('approve');
    expect(badge).toHaveAttribute('data-verdict', 'approve');
  });

  it('does not render a badge when verdict is missing', () => {
    render(<OutcomeCard yaml="reason: no verdict here" />);
    expect(screen.queryByText('pass')).toBeNull();
    expect(screen.queryByText('unknown')).toBeNull();
  });

  it('shows "Show raw" button initially', () => {
    render(<OutcomeCard yaml="verdict: pass" />);
    expect(screen.getByRole('button', { name: /show raw/i })).toBeInTheDocument();
  });

  it('clicking "Show raw" toggles to display raw YAML', () => {
    const yaml = 'verdict: pass\nreason: looks good';
    render(<OutcomeCard yaml={yaml} />);
    const btn = screen.getByRole('button', { name: /show raw/i });
    fireEvent.click(btn);
    expect(screen.getByText('Hide raw')).toBeInTheDocument();
    // Use regex partial match to find the pre element containing the raw YAML
    expect(screen.getByText(/verdict: pass/, { selector: 'pre' })).toBeInTheDocument();
  });

  it('clicking "Hide raw" hides the raw YAML', () => {
    render(<OutcomeCard yaml="verdict: pass" />);
    const btn = screen.getByRole('button', { name: /show raw/i });
    fireEvent.click(btn);
    const hideBtn = screen.getByRole('button', { name: /hide raw/i });
    fireEvent.click(hideBtn);
    expect(screen.getByRole('button', { name: /show raw/i })).toBeInTheDocument();
  });

  it('renders non-verdict fields as key/value pairs', () => {
    render(<OutcomeCard yaml={"verdict: pass\nreason: All tests passed"} />);
    expect(screen.getByText('reason')).toBeInTheDocument();
    expect(screen.getByText('All tests passed')).toBeInTheDocument();
  });

  it('does not render verdict as a field in the field list', () => {
    render(<OutcomeCard yaml={"verdict: pass\nreason: ok"} />);
    // verdict appears once as badge, not in the field list
    // queryAllByText returns [] instead of throwing when nothing is found
    const verdictElements = screen.queryAllByText('verdict');
    // verdict label should not appear in the field rows (only badge text "pass")
    expect(verdictElements).toHaveLength(0);
  });
});
