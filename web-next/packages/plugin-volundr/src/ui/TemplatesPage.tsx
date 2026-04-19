import { useState, useCallback } from 'react';
import {
  StateDot,
  Drawer,
  DrawerContent,
  Field,
  Input,
  Textarea,
  ValidationSummary,
} from '@niuulabs/ui';
import type { ValidationError } from '@niuulabs/ui';
import type { Template } from '../domain/template';
import type { PodSpec } from '../domain/pod';
import { cloneName, buildCloneSpec } from '../application/templateUtils';
import {
  useTemplates,
  useCreateTemplate,
  useUpdateTemplate,
} from './useTemplates';
import { TemplateCard } from './TemplateCard';
import './TemplatesPage.css';

// ---------------------------------------------------------------------------
// Editor form state
// ---------------------------------------------------------------------------

interface FormValues {
  name: string;
  image: string;
  tag: string;
  cpuRequest: string;
  cpuLimit: string;
  memRequestMi: string;
  memLimitMi: string;
  gpuCount: string;
  ttlSec: string;
  idleTimeoutSec: string;
  envJson: string;
  envSecretRefs: string;
  tools: string;
  clusterAffinity: string;
  tolerations: string;
}

function specToForm(name: string, spec: PodSpec): FormValues {
  return {
    name,
    image: spec.image,
    tag: spec.tag,
    cpuRequest: spec.resources.cpuRequest,
    cpuLimit: spec.resources.cpuLimit,
    memRequestMi: String(spec.resources.memRequestMi),
    memLimitMi: String(spec.resources.memLimitMi),
    gpuCount: String(spec.resources.gpuCount),
    ttlSec: String(spec.ttlSec),
    idleTimeoutSec: String(spec.idleTimeoutSec),
    envJson: Object.keys(spec.env).length > 0 ? JSON.stringify(spec.env, null, 2) : '',
    envSecretRefs: spec.envSecretRefs.join(', '),
    tools: spec.tools.join(', '),
    clusterAffinity: (spec.clusterAffinity ?? []).join(', '),
    tolerations: (spec.tolerations ?? []).join(', '),
  };
}

function blankForm(): FormValues {
  return {
    name: '',
    image: 'ghcr.io/niuulabs/skuld',
    tag: 'latest',
    cpuRequest: '1',
    cpuLimit: '2',
    memRequestMi: '512',
    memLimitMi: '1024',
    gpuCount: '0',
    ttlSec: '3600',
    idleTimeoutSec: '600',
    envJson: '',
    envSecretRefs: '',
    tools: '',
    clusterAffinity: '',
    tolerations: '',
  };
}

function csvToArray(s: string): string[] {
  return s
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function formToSpec(values: FormValues): PodSpec {
  let env: Record<string, string> = {};
  if (values.envJson.trim()) {
    try {
      env = JSON.parse(values.envJson) as Record<string, string>;
    } catch {
      env = {};
    }
  }

  return {
    image: values.image,
    tag: values.tag,
    mounts: [],
    env,
    envSecretRefs: csvToArray(values.envSecretRefs),
    tools: csvToArray(values.tools),
    resources: {
      cpuRequest: values.cpuRequest,
      cpuLimit: values.cpuLimit,
      memRequestMi: Number(values.memRequestMi),
      memLimitMi: Number(values.memLimitMi),
      gpuCount: Number(values.gpuCount),
    },
    ttlSec: Number(values.ttlSec),
    idleTimeoutSec: Number(values.idleTimeoutSec),
    clusterAffinity: csvToArray(values.clusterAffinity),
    tolerations: csvToArray(values.tolerations),
  };
}

function validate(values: FormValues): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!values.name.trim()) errors.push({ id: 'name', label: 'Name', message: 'Name is required' });
  if (!values.image.trim())
    errors.push({ id: 'image', label: 'Image', message: 'Image is required' });
  if (!values.tag.trim()) errors.push({ id: 'tag', label: 'Tag', message: 'Tag is required' });
  if (Number.isNaN(Number(values.memRequestMi)) || Number(values.memRequestMi) <= 0)
    errors.push({
      id: 'memRequestMi',
      label: 'Mem Request',
      message: 'Memory request must be a positive number',
    });
  if (Number.isNaN(Number(values.ttlSec)) || Number(values.ttlSec) <= 0)
    errors.push({ id: 'ttlSec', label: 'TTL', message: 'TTL must be a positive number' });
  if (values.envJson.trim()) {
    try {
      JSON.parse(values.envJson);
    } catch {
      errors.push({
        id: 'envJson',
        label: 'Env vars',
        message: 'Environment variables must be valid JSON',
      });
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// TemplatesPage
// ---------------------------------------------------------------------------

export function TemplatesPage() {
  const templates = useTemplates();
  const createMutation = useCreateTemplate();
  const updateMutation = useUpdateTemplate();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormValues>(blankForm);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [cloningId, setCloningId] = useState<string | null>(null);

  const openEditor = useCallback((template: Template) => {
    setEditingId(template.id);
    setForm(specToForm(template.name, template.spec));
    setErrors([]);
    setDrawerOpen(true);
  }, []);

  const openNew = useCallback(() => {
    setEditingId(null);
    setForm(blankForm());
    setErrors([]);
    setDrawerOpen(true);
  }, []);

  const handleClone = useCallback(
    (template: Template) => {
      setCloningId(template.id);
      const spec = buildCloneSpec(template);
      createMutation.mutate(
        { name: cloneName(template.name), spec },
        { onSettled: () => setCloningId(null) },
      );
    },
    [createMutation],
  );

  const handleSave = useCallback(() => {
    const errs = validate(form);
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    const spec = formToSpec(form);

    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, spec }, { onSuccess: () => setDrawerOpen(false) });
    } else {
      createMutation.mutate({ name: form.name, spec }, { onSuccess: () => setDrawerOpen(false) });
    }
  }, [form, editingId, updateMutation, createMutation]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="tpl-page">
      <div className="tpl-page__header">
        <h2 className="tpl-page__title">Templates</h2>
        <button className="tpl-page__new-btn" onClick={openNew} aria-label="New template">
          + New Template
        </button>
      </div>

      <p className="tpl-page__subtitle">
        Reusable pod templates — define image, resources, env, and tool allowlists once; start
        sessions from a template.
      </p>

      {templates.isLoading && (
        <div className="tpl-page__status">
          <StateDot state="processing" pulse />
          <span>loading templates…</span>
        </div>
      )}

      {templates.isError && (
        <div className="tpl-page__status">
          <StateDot state="failed" />
          <span>
            {templates.error instanceof Error
              ? templates.error.message
              : 'failed to load templates'}
          </span>
        </div>
      )}

      {templates.data && templates.data.length === 0 && (
        <p className="tpl-page__empty">No templates yet — create one to get started.</p>
      )}

      {templates.data && templates.data.length > 0 && (
        <ul className="tpl-page__list" aria-label="Pod templates">
          {templates.data.map((t) => (
            <li key={t.id}>
              <TemplateCard
                template={t}
                onEdit={openEditor}
                onClone={handleClone}
                isCloning={cloningId === t.id}
              />
            </li>
          ))}
        </ul>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Template editor drawer                                              */}
      {/* ------------------------------------------------------------------ */}
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent
          title={editingId !== null ? 'Edit Template' : 'New Template'}
          description="Configure image, resources, env vars, and scheduling options."
          side="right"
          width={480}
        >
          <div className="tpl-editor">
            {errors.length > 0 && <ValidationSummary errors={errors} />}

            <section className="tpl-editor__section">
              <h3 className="tpl-editor__section-title">Identity</h3>
              <Field label="Name" required error={errors.find((e) => e.id === 'name')?.message}>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. default"
                  disabled={editingId !== null}
                />
              </Field>
            </section>

            <section className="tpl-editor__section">
              <h3 className="tpl-editor__section-title">Container</h3>
              <Field label="Image" required error={errors.find((e) => e.id === 'image')?.message}>
                <Input
                  value={form.image}
                  onChange={(e) => setForm((f) => ({ ...f, image: e.target.value }))}
                  placeholder="ghcr.io/niuulabs/skuld"
                />
              </Field>
              <Field label="Tag" required error={errors.find((e) => e.id === 'tag')?.message}>
                <Input
                  value={form.tag}
                  onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))}
                  placeholder="latest"
                />
              </Field>
            </section>

            <section className="tpl-editor__section">
              <h3 className="tpl-editor__section-title">Resources</h3>
              <div className="tpl-editor__row">
                <Field label="CPU Request">
                  <Input
                    value={form.cpuRequest}
                    onChange={(e) => setForm((f) => ({ ...f, cpuRequest: e.target.value }))}
                    placeholder="1"
                  />
                </Field>
                <Field label="CPU Limit">
                  <Input
                    value={form.cpuLimit}
                    onChange={(e) => setForm((f) => ({ ...f, cpuLimit: e.target.value }))}
                    placeholder="2"
                  />
                </Field>
              </div>
              <div className="tpl-editor__row">
                <Field
                  label="Mem Request (Mi)"
                  error={errors.find((e) => e.id === 'memRequestMi')?.message}
                >
                  <Input
                    type="number"
                    value={form.memRequestMi}
                    onChange={(e) => setForm((f) => ({ ...f, memRequestMi: e.target.value }))}
                    placeholder="512"
                  />
                </Field>
                <Field label="Mem Limit (Mi)">
                  <Input
                    type="number"
                    value={form.memLimitMi}
                    onChange={(e) => setForm((f) => ({ ...f, memLimitMi: e.target.value }))}
                    placeholder="1024"
                  />
                </Field>
              </div>
              <Field label="GPU Count">
                <Input
                  type="number"
                  value={form.gpuCount}
                  onChange={(e) => setForm((f) => ({ ...f, gpuCount: e.target.value }))}
                  placeholder="0"
                />
              </Field>
            </section>

            <section className="tpl-editor__section">
              <h3 className="tpl-editor__section-title">Timing</h3>
              <div className="tpl-editor__row">
                <Field label="TTL (seconds)" error={errors.find((e) => e.id === 'ttlSec')?.message}>
                  <Input
                    type="number"
                    value={form.ttlSec}
                    onChange={(e) => setForm((f) => ({ ...f, ttlSec: e.target.value }))}
                    placeholder="3600"
                  />
                </Field>
                <Field label="Idle Timeout (seconds)">
                  <Input
                    type="number"
                    value={form.idleTimeoutSec}
                    onChange={(e) => setForm((f) => ({ ...f, idleTimeoutSec: e.target.value }))}
                    placeholder="600"
                  />
                </Field>
              </div>
            </section>

            <section className="tpl-editor__section">
              <h3 className="tpl-editor__section-title">Environment</h3>
              <Field
                label="Env vars (JSON)"
                hint='e.g. {"API_URL": "https://api.niuu.world"}'
                error={errors.find((e) => e.id === 'envJson')?.message}
              >
                <Textarea
                  value={form.envJson}
                  onChange={(e) => setForm((f) => ({ ...f, envJson: e.target.value }))}
                  rows={4}
                  placeholder="{}"
                />
              </Field>
              <Field
                label="Secret refs"
                hint="Comma-separated env key names to treat as secret refs"
              >
                <Input
                  value={form.envSecretRefs}
                  onChange={(e) => setForm((f) => ({ ...f, envSecretRefs: e.target.value }))}
                  placeholder="TOKEN, API_KEY"
                />
              </Field>
            </section>

            <section className="tpl-editor__section">
              <h3 className="tpl-editor__section-title">Tools</h3>
              <Field label="Tool allowlist" hint="Comma-separated tool IDs from Ravn's registry">
                <Input
                  value={form.tools}
                  onChange={(e) => setForm((f) => ({ ...f, tools: e.target.value }))}
                  placeholder="bash, python, git"
                />
              </Field>
            </section>

            <section className="tpl-editor__section">
              <h3 className="tpl-editor__section-title">Scheduling</h3>
              <Field
                label="Cluster affinity"
                hint="Comma-separated cluster IDs this template prefers"
              >
                <Input
                  value={form.clusterAffinity}
                  onChange={(e) => setForm((f) => ({ ...f, clusterAffinity: e.target.value }))}
                  placeholder="cl-eitri, cl-brokkr"
                />
              </Field>
              <Field label="Taint tolerations" hint="Comma-separated taint keys to tolerate">
                <Input
                  value={form.tolerations}
                  onChange={(e) => setForm((f) => ({ ...f, tolerations: e.target.value }))}
                  placeholder="gpu-only, spot"
                />
              </Field>
            </section>

            <div className="tpl-editor__footer">
              <button
                className="tpl-editor__cancel"
                onClick={() => setDrawerOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="tpl-editor__save"
                onClick={handleSave}
                disabled={isSaving}
                type="button"
                aria-label="Save template"
              >
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
