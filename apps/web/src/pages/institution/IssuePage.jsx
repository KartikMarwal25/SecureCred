import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { issuanceRequestSchema, CERTIFICATE_TYPE, ERROR_CODE } from '@securecred/shared';
import { issueCertificate, ApiError } from '../../api/client.js';
import { Button } from '../../components/Button.jsx';
import { FieldError } from '../../components/FieldError.jsx';

const CERTIFICATE_TYPE_LABELS = {
  [CERTIFICATE_TYPE.DEGREE]: 'Degree',
  [CERTIFICATE_TYPE.DIPLOMA]: 'Diploma',
  [CERTIFICATE_TYPE.COURSE_COMPLETION]: 'Course completion',
};

const FIELD_LABELS = {
  holderName: 'Holder full name',
  holderEmail: 'Holder email',
  enrollmentNumber: 'Enrolment number',
  title: 'Certificate title',
  certificateType: 'Certificate type',
  gradeOrResult: 'Grade or result',
  issueDate: 'Date of issue',
  course: 'Course or programme',
};

const EMPTY_FORM = {
  holderName: '',
  holderEmail: '',
  enrollmentNumber: '',
  title: '',
  certificateType: '',
  gradeOrResult: '',
  issueDate: '',
  course: '',
};

const TODAY_ISO = new Date().toISOString().slice(0, 10);

function inputClassName(hasError) {
  return `min-h-[44px] w-full rounded-[4px] border bg-paper px-12 py-8 text-[16px] leading-[24px] text-body ${
    hasError ? 'border-bad' : 'border-edge-ctl'
  }`;
}

export function IssuePage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const summaryRef = useRef(null);

  const validateField = useCallback((field, value) => {
    const shape = issuanceRequestSchema.shape[field];
    if (!shape) return null;
    const normalized = field === 'gradeOrResult' && value === '' ? undefined : value;
    const result = shape.safeParse(normalized);
    return result.success ? null : (result.error.issues[0]?.message ?? 'This field is invalid.');
  }, []);

  const handleChange = (field) => (event) => {
    const { value } = event.target;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleBlur = (field) => () => {
    setErrors((prev) => ({ ...prev, [field]: validateField(field, form[field]) }));
  };

  const focusSummary = () => {
    requestAnimationFrame(() => summaryRef.current?.focus());
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitError(null);

    const payload = {
      holderName: form.holderName,
      holderEmail: form.holderEmail,
      enrollmentNumber: form.enrollmentNumber,
      title: form.title,
      certificateType: form.certificateType,
      course: form.course,
      gradeOrResult: form.gradeOrResult || undefined,
      issueDate: form.issueDate,
    };

    const result = issuanceRequestSchema.safeParse(payload);
    if (!result.success) {
      const fieldErrors = {};
      result.error.issues.forEach((issue) => {
        const key = issue.path[0];
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      });
      setErrors(fieldErrors);
      focusSummary();
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      const data = await issueCertificate(result.data);
      navigate(`/app/certificate/${data.certificateId}`);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.code === ERROR_CODE.E_DUPLICATE_CERTIFICATE) {
        const message =
          err.message || 'A credential already exists for this enrolment number and programme.';
        setErrors({ enrollmentNumber: message, course: message });
      } else {
        setErrors({});
        setSubmitError(
          err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
        );
      }
      focusSummary();
    }
  };

  const errorEntries = Object.entries(errors).filter(([, message]) => message);
  const showSummary = errorEntries.length > 0 || submitError;

  return (
    <div className="flex flex-col gap-24">
      <h1 className="text-[24px] font-bold leading-[32px] text-ink">Issue a certificate</h1>

      <div className="rounded-[6px] border border-warn bg-warn-bg p-16">
        <p className="prose-copy text-[14px] leading-[20px] text-warn">
          Once a certificate is issued and confirmed on the blockchain, it cannot be edited or
          deleted. If a detail is wrong afterwards, the only options are to revoke it and issue a
          corrected certificate separately.
        </p>
      </div>

      {showSummary ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="rounded-[6px] border border-bad bg-bad-bg p-16"
        >
          <p className="text-[16px] font-bold leading-[24px] text-bad">
            {submitError ||
              `${errorEntries.length} field${errorEntries.length === 1 ? '' : 's'} need attention before this can be issued.`}
          </p>
          {errorEntries.length > 0 ? (
            <ul className="mt-8 flex flex-col gap-4">
              {errorEntries.map(([field, message]) => (
                <li key={field} className="text-[14px] leading-[20px] text-bad">
                  <a href={`#field-${field}`} className="font-bold underline">
                    {FIELD_LABELS[field] || field}
                  </a>
                  : {message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate>
        <div className="grid grid-cols-1 gap-16 md:grid-cols-2">
          <div>
            <label htmlFor="field-holderName" className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-body">
              Holder full name
            </label>
            <input
              id="field-holderName"
              type="text"
              value={form.holderName}
              onChange={handleChange('holderName')}
              onBlur={handleBlur('holderName')}
              aria-invalid={errors.holderName ? 'true' : undefined}
              aria-describedby={errors.holderName ? 'field-holderName-error' : undefined}
              className={inputClassName(errors.holderName)}
            />
            <FieldError id="field-holderName-error" message={errors.holderName} />
          </div>

          <div>
            <label htmlFor="field-holderEmail" className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-body">
              Holder email
            </label>
            <input
              id="field-holderEmail"
              type="email"
              value={form.holderEmail}
              onChange={handleChange('holderEmail')}
              onBlur={handleBlur('holderEmail')}
              aria-invalid={errors.holderEmail ? 'true' : undefined}
              aria-describedby={errors.holderEmail ? 'field-holderEmail-error' : undefined}
              className={inputClassName(errors.holderEmail)}
            />
            <FieldError id="field-holderEmail-error" message={errors.holderEmail} />
          </div>

          <div>
            <label htmlFor="field-enrollmentNumber" className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-body">
              Enrolment number
            </label>
            <input
              id="field-enrollmentNumber"
              type="text"
              value={form.enrollmentNumber}
              onChange={handleChange('enrollmentNumber')}
              onBlur={handleBlur('enrollmentNumber')}
              aria-invalid={errors.enrollmentNumber ? 'true' : undefined}
              aria-describedby={errors.enrollmentNumber ? 'field-enrollmentNumber-error' : undefined}
              className={inputClassName(errors.enrollmentNumber)}
            />
            <FieldError id="field-enrollmentNumber-error" message={errors.enrollmentNumber} />
          </div>

          <div>
            <label htmlFor="field-certificateType" className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-body">
              Certificate type
            </label>
            <select
              id="field-certificateType"
              value={form.certificateType}
              onChange={handleChange('certificateType')}
              onBlur={handleBlur('certificateType')}
              aria-invalid={errors.certificateType ? 'true' : undefined}
              aria-describedby={errors.certificateType ? 'field-certificateType-error' : undefined}
              className={inputClassName(errors.certificateType)}
            >
              <option value="">Choose a type</option>
              {Object.values(CERTIFICATE_TYPE).map((value) => (
                <option key={value} value={value}>
                  {CERTIFICATE_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
            <FieldError id="field-certificateType-error" message={errors.certificateType} />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="field-title" className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-body">
              Certificate title
            </label>
            <input
              id="field-title"
              type="text"
              value={form.title}
              onChange={handleChange('title')}
              onBlur={handleBlur('title')}
              aria-invalid={errors.title ? 'true' : undefined}
              aria-describedby={errors.title ? 'field-title-error' : undefined}
              className={inputClassName(errors.title)}
            />
            <FieldError id="field-title-error" message={errors.title} />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="field-course" className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-body">
              Course or programme
            </label>
            <input
              id="field-course"
              type="text"
              value={form.course}
              onChange={handleChange('course')}
              onBlur={handleBlur('course')}
              aria-invalid={errors.course ? 'true' : undefined}
              aria-describedby={errors.course ? 'field-course-error' : undefined}
              className={inputClassName(errors.course)}
            />
            <FieldError id="field-course-error" message={errors.course} />
          </div>

          <div>
            <label htmlFor="field-gradeOrResult" className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-body">
              Grade or result (optional)
            </label>
            <input
              id="field-gradeOrResult"
              type="text"
              value={form.gradeOrResult}
              onChange={handleChange('gradeOrResult')}
              onBlur={handleBlur('gradeOrResult')}
              aria-invalid={errors.gradeOrResult ? 'true' : undefined}
              aria-describedby={errors.gradeOrResult ? 'field-gradeOrResult-error' : undefined}
              className={inputClassName(errors.gradeOrResult)}
            />
            <FieldError id="field-gradeOrResult-error" message={errors.gradeOrResult} />
          </div>

          <div>
            <label htmlFor="field-issueDate" className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-body">
              Date of issue
            </label>
            <input
              id="field-issueDate"
              type="date"
              max={TODAY_ISO}
              value={form.issueDate}
              onChange={handleChange('issueDate')}
              onBlur={handleBlur('issueDate')}
              aria-invalid={errors.issueDate ? 'true' : undefined}
              aria-describedby={errors.issueDate ? 'field-issueDate-error' : undefined}
              className={inputClassName(errors.issueDate)}
            />
            <FieldError id="field-issueDate-error" message={errors.issueDate} />
          </div>
        </div>

        <div className="mt-24">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Issuing…' : 'Issue credential'}
          </Button>
        </div>
      </form>
    </div>
  );
}
