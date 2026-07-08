// Cover Letter Templates
export const COVER_LETTER_TEMPLATES = {
  professional: {
    intro: "I am writing to express my strong interest in the {position} position at {company}. With my background in {field}, I am confident that my skills and qualifications align well with the requirements of this role.",
    experience: "In my previous role as {previous_role}, I developed strong skills in {skills} and successfully {achievement}. These experiences have prepared me to contribute effectively to your team.",
    skills: "My key strengths include: {key_skills}. I am particularly proficient in {proficiency} and have a proven track record of delivering results.",
    whyCompany: "I have been following {company}'s work in the {industry} industry and I am impressed by your commitment to {value}. I am excited about the opportunity to contribute to your mission and grow with your team.",
    closing: "Thank you for considering my application. I look forward to the opportunity to discuss how my background and skills can contribute to the success of {company}."
  },
  
  enthusiastic: {
    intro: "Hi {company} Team! I was thrilled to see the {position} opening. As someone who is passionate about {field}, I've been following {company}'s work and I'm genuinely excited about the impact you're making.",
    experience: "I bring {skills} and a proven track record of {achievement}. I've worked on projects that {project_description} and I'm eager to bring this experience to {company}.",
    skills: "My core competencies include: {key_skills}. I'm always learning and staying up-to-date with the latest trends in {field}.",
    whyCompany: "What excites me most about {company} is your {value} approach. I share your values and I'm looking forward to contributing to your continued success.",
    closing: "Let's connect and chat about how I can help {company} achieve even greater things! Looking forward to hearing from you."
  },
  
  concise: {
    intro: "I am applying for the {position} position at {company}. My experience in {field} makes me a strong candidate for this role.",
    experience: "I have {years} years of experience in {field}, with a focus on {specialization}. I have successfully {achievement}.",
    skills: "My key skills include {key_skills}. I am proficient in {proficiency}.",
    whyCompany: "I am drawn to {company} because of your reputation for {value}. I believe I can contribute to your team.",
    closing: "Thank you for your consideration. I look forward to hearing from you."
  }
};

// Helper function to apply a template with custom replacements
export const applyTemplate = (templateName, replacements = {}) => {
  const template = COVER_LETTER_TEMPLATES[templateName];
  if (!template) return null;

  // Default replacements
  const defaultReplacements = {
    '{position}': 'this position',
    '{company}': 'your company',
    '{field}': 'this field',
    '{previous_role}': 'my previous role',
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

  const allReplacements = { ...defaultReplacements, ...replacements };
  
  const appliedSections = {};
  for (const [key, value] of Object.entries(template)) {
    let text = value;
    for (const [placeholder, replacement] of Object.entries(allReplacements)) {
      text = text.replaceAll(placeholder, replacement);
    }
    appliedSections[key] = text;
  }
  
  return appliedSections;
};

// Helper to combine sections into full letter
export const combineSections = (sections) => {
  const parts = [
    sections.intro,
    sections.experience,
    sections.skills,
    sections.whyCompany,
    sections.closing
  ];
  return parts.filter(s => s && s.trim()).join('\n\n');
};

export default COVER_LETTER_TEMPLATES;