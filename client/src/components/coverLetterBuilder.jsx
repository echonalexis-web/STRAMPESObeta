import React, { useState, useEffect } from 'react';
import { COVER_LETTER_TEMPLATES } from '../utils/coverLetterTemplates.js';
import '../styles/coverLetterBuilder.css';

const CoverLetterBuilder = ({
  value = '',
  onChange,
  jobTitle = '',
  companyName = '',
  maxLength = 1000,
  minLength = 10,
  error = ''
}) => {
  const [activeTab, setActiveTab] = useState('builder');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [sections, setSections] = useState({
    intro: '',
    experience: '',
    skills: '',
    whyCompany: '',
    closing: ''
  });

  // Sync with parent component when value changes externally
  useEffect(() => {
    if (value && !sections.intro && !sections.experience && !sections.skills && !sections.whyCompany && !sections.closing) {
      // If parent passes a value, try to parse it or set it as intro
      setSections(prev => ({
        ...prev,
        intro: value
      }));
    }
  }, [value]);

  // Get full cover letter from sections
  const getFullCoverLetter = () => {
    const parts = [
      sections.intro,
      sections.experience,
      sections.skills,
      sections.whyCompany,
      sections.closing
    ];
    return parts.filter(s => s.trim()).join('\n\n');
  };

  // Update parent when sections change
  useEffect(() => {
    const fullLetter = getFullCoverLetter();
    if (onChange) {
      onChange(fullLetter);
    }
  }, [sections]);

  // Get character count for each section
  const getSectionCharCount = (text) => text.length;

  // Get total character count
  const getTotalCharCount = () => getFullCoverLetter().length;

  // Update a specific section
  const updateSection = (sectionName, text) => {
    setSections(prev => ({
      ...prev,
      [sectionName]: text
    }));
  };

  // Apply template
  const applyTemplate = (templateName) => {
    setSelectedTemplate(templateName);
    const template = COVER_LETTER_TEMPLATES[templateName];
    if (!template) return;

    const replacements = {
      '{position}': jobTitle || 'this position',
      '{company}': companyName || 'your company',
      '{field}': '[your field]',
      '{previous_role}': '[your previous role]',
      '{skills}': '[your key skills]',
      '{achievement}': '[your notable achievement]',
      '{key_skills}': '[list your key skills]',
      '{proficiency}': '[your area of expertise]',
      '{industry}': 'the industry',
      '{value}': 'excellence',
      '{years}': '[your years of experience]',
      '{specialization}': '[your specialization]',
      '{project_description}': '[describe your projects]'
    };

    const appliedSections = {};
    for (const [key, value] of Object.entries(template)) {
      let text = value;
      for (const [placeholder, replacement] of Object.entries(replacements)) {
        text = text.replaceAll(placeholder, replacement);
      }
      appliedSections[key] = text;
    }

    setSections(appliedSections);
  };

  // Clear all sections
  const clearAll = () => {
    setSelectedTemplate('');
    setSections({
      intro: '',
      experience: '',
      skills: '',
      whyCompany: '',
      closing: ''
    });
  };

  // Get character count color for total
  const getTotalCharCountColor = () => {
    const length = getTotalCharCount();
    if (length === 0) return 'text-muted';
    if (length < minLength) return 'text-warning';
    if (length > maxLength) return 'text-danger';
    return 'text-success';
  };

  // Get character count color for a section
  const getSectionCharCountColor = (text) => {
    const length = text.length;
    if (length === 0) return 'text-muted';
    if (length > 300) return 'text-warning';
    return 'text-success';
  };

  return (
    <div className="cover-letter-builder-wrapper">
      {/* Template Selector */}
      <div className="template-selector">
        <label>📝 Quick Start with a Template</label>
        <div className="template-buttons">
          <button
            type="button"
            className={`template-btn ${selectedTemplate === 'professional' ? 'active' : ''}`}
            onClick={() => applyTemplate('professional')}
          >
            Professional
          </button>
          <button
            type="button"
            className={`template-btn ${selectedTemplate === 'enthusiastic' ? 'active' : ''}`}
            onClick={() => applyTemplate('enthusiastic')}
          >
            Enthusiastic
          </button>
          <button
            type="button"
            className={`template-btn ${selectedTemplate === 'concise' ? 'active' : ''}`}
            onClick={() => applyTemplate('concise')}
          >
            Concise
          </button>
          <button
            type="button"
            className="template-btn template-btn-clear"
            onClick={clearAll}
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="builder-tabs">
        <button
          type="button"
          className={`builder-tab ${activeTab === 'builder' ? 'active' : ''}`}
          onClick={() => setActiveTab('builder')}
        >
          ✏️ Builder
        </button>
        <button
          type="button"
          className={`builder-tab ${activeTab === 'preview' ? 'active' : ''}`}
          onClick={() => setActiveTab('preview')}
        >
          📄 Preview
        </button>
      </div>
      {error && (
        <div className="cover-letter-error-message" role="alert" aria-live="polite">
          {error}
        </div>
      )}

      {/* Builder Tab */}
      {activeTab === 'builder' && (
        <div className="cover-letter-builder">
          <div className="form-group">
            <label>
              1. Introduction
              <span className="char-count">{getSectionCharCount(sections.intro)}</span>
            </label>
            <textarea
              placeholder="Who you are and what position you're applying for..."
              value={sections.intro}
              onChange={(e) => updateSection('intro', e.target.value)}
              className={`form-control ${getSectionCharCount(sections.intro) > 300 ? 'is-warning' : ''}`}
              rows="2"
            />
            <small className="hint">Example: "I am writing to apply for the {jobTitle || 'position'} position..."</small>
            <div className="char-counter-small">
              <span className={getSectionCharCountColor(sections.intro)}>
                {getSectionCharCount(sections.intro)} / 300 recommended
              </span>
            </div>
          </div>

          <div className="form-group">
            <label>
              2. Relevant Experience
              <span className="char-count">{getSectionCharCount(sections.experience)}</span>
            </label>
            <textarea
              placeholder="Describe your relevant work experience..."
              value={sections.experience}
              onChange={(e) => updateSection('experience', e.target.value)}
              className={`form-control ${getSectionCharCount(sections.experience) > 300 ? 'is-warning' : ''}`}
              rows="2"
            />
            <small className="hint">Highlight 2-3 key experiences that relate to this role</small>
            <div className="char-counter-small">
              <span className={getSectionCharCountColor(sections.experience)}>
                {getSectionCharCount(sections.experience)} / 300 recommended
              </span>
            </div>
          </div>

          <div className="form-group">
            <label>
              3. Key Skills
              <span className="char-count">{getSectionCharCount(sections.skills)}</span>
            </label>
            <textarea
              placeholder="What skills make you a great fit?"
              value={sections.skills}
              onChange={(e) => updateSection('skills', e.target.value)}
              className={`form-control ${getSectionCharCount(sections.skills) > 300 ? 'is-warning' : ''}`}
              rows="2"
            />
            <small className="hint">List 3-5 skills that match the job requirements</small>
            <div className="char-counter-small">
              <span className={getSectionCharCountColor(sections.skills)}>
                {getSectionCharCount(sections.skills)} / 300 recommended
              </span>
            </div>
          </div>

          <div className="form-group">
            <label>
              4. Why This Company?
              <span className="char-count">{getSectionCharCount(sections.whyCompany)}</span>
            </label>
            <textarea
              placeholder="Why are you interested in this company?"
              value={sections.whyCompany}
              onChange={(e) => updateSection('whyCompany', e.target.value)}
              className={`form-control ${getSectionCharCount(sections.whyCompany) > 300 ? 'is-warning' : ''}`}
              rows="2"
            />
            <small className="hint">Research the company and mention something specific</small>
            <div className="char-counter-small">
              <span className={getSectionCharCountColor(sections.whyCompany)}>
                {getSectionCharCount(sections.whyCompany)} / 300 recommended
              </span>
            </div>
          </div>

          <div className="form-group">
            <label>
              5. Closing
              <span className="char-count">{getSectionCharCount(sections.closing)}</span>
            </label>
            <textarea
              placeholder="Professional sign-off..."
              value={sections.closing}
              onChange={(e) => updateSection('closing', e.target.value)}
              className={`form-control ${getSectionCharCount(sections.closing) > 300 ? 'is-warning' : ''}`}
              rows="2"
            />
            <small className="hint">Thank them for their time and express interest in an interview</small>
            <div className="char-counter-small">
              <span className={getSectionCharCountColor(sections.closing)}>
                {getSectionCharCount(sections.closing)} / 300 recommended
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Preview Tab */}
      {activeTab === 'preview' && (
        <div className="cover-letter-preview">
          <div className="preview-header">
            <h4>📄 Your Cover Letter</h4>
            <div className="total-char-count">
              <span className={getTotalCharCountColor()}>
                {getTotalCharCount()} / {maxLength} characters
              </span>
              {getTotalCharCount() > 0 && getTotalCharCount() < minLength && (
                <span className="text-warning"> (minimum {minLength})</span>
              )}
              {getTotalCharCount() > maxLength && (
                <span className="text-danger"> (exceeded!)</span>
              )}
            </div>
          </div>
          <div className="preview-content">
            {getFullCoverLetter() || "Your cover letter preview will appear here. Start building it in the 'Builder' tab."}
          </div>
          {error && (
            <div className="invalid-feedback" style={{ display: 'block' }}>
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CoverLetterBuilder;