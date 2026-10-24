import type { Component, Ref } from 'vue';
import type { ConfirmOptions } from '#ui/composables/useConfirm';
import type { IconName } from '#ui/lib/icons';

/** Shared types of the UI kit (components in `components/common`). */

/**
 * What kit components need from a form created with useZodForm (structural, so any schema fits).
 */
export interface FormLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  values: Record<string, any>;
  errors: Record<string, string | undefined>;
  submitting: Ref<boolean>;
  validateField: (name: string) => void;
  validateFields: (names: string[]) => boolean;
  validate: () => unknown;
  firstErrorField: (order?: string[]) => string | undefined;
}

/** Item of <ActionMenu>. */
export interface ActionItem {
  label: string;
  /** Semantic icon name (`edit`, `delete`, …) or a Lucide component. */
  icon?: IconName | Component;
  onSelect: () => unknown;
  destructive?: boolean;
  disabled?: boolean;
  /** Hidden items are skipped (e.g. `hidden: !can('projects.manage')`). */
  hidden?: boolean;
  /** Draws a separator before this item. */
  separator?: boolean;
  shortcut?: string;
  /** Asks first (useConfirm); the action runs only if the person confirms. */
  confirm?: ConfirmOptions;
  testid?: string;
}

export interface FieldOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export type FieldType =
  | 'text'
  | 'email'
  | 'password'
  | 'url'
  | 'tel'
  | 'number'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'switch'
  | 'date'
  | 'tags'
  | 'slider';

/** Field definition rendered by <FormFields>. `name` is the key in the form values (and the schema). */
export interface FormFieldDef {
  name: string;
  label: string;
  type?: FieldType;
  description?: string;
  placeholder?: string;
  /** Visual marker only: the Zod schema decides what is required. */
  required?: boolean;
  options?: FieldOption[];
  /** Columns spanned in the grid (`full` spans all). */
  span?: 1 | 2 | 3 | 'full';
  rows?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  autocomplete?: string;
  /** Text shown before/after the input (e.g. "US$", "%"). */
  prefix?: string;
  suffix?: string;
  testid?: string;
}

/** Step of <FormWizard> / useWizard. */
export interface WizardStep {
  id: string;
  title: string;
  description?: string;
  /** Form fields validated before leaving the step. */
  fields?: string[];
  icon?: IconName | Component;
  optional?: boolean;
}

/** Item of <SectionNav>. */
export interface SectionNavItem {
  value: string;
  label: string;
  icon?: IconName | Component;
  description?: string;
  badge?: string | number;
  /** Navigates instead of selecting (router link). */
  to?: string;
  disabled?: boolean;
}

/** Series of a chart. */
export interface ChartSeries {
  key: string;
  label: string;
  color?: string;
}

export type ViewMode = 'table' | 'cards';
