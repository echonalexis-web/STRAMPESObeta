import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJobMonitoringRecord } from './jobMonitoringData.js';

test('normalizeJobMonitoringRecord maps database job data to the UI model', () => {
  const record = normalizeJobMonitoringRecord({
    _id: 'abc123',
    title: 'Systems Analyst',
    description: 'Support digital approval workflows.',
    location: 'Boac',
    jobType: 'Full-time',
    industry: 'IT & Software',
    salary: '₱25,000 - ₱30,000',
    slots: 4,
    status: 'active',
    createdAt: '2026-09-01T00:00:00.000Z',
    employer: {
      _id: 'emp1',
      companyName: 'Provincial Government Office',
      name: 'Office Admin',
      verificationStatus: 'verified',
    },
    applicantCount: 17,
    qualifications: [
      { value: 'Business process analysis' },
      { value: 'Reporting' },
    ],
  });

  assert.equal(record.id, 'abc123');
  assert.equal(record.title, 'Systems Analyst');
  assert.equal(record.employer, 'Provincial Government Office');
  assert.equal(record.municipality, 'Boac (Capital)');
  assert.equal(record.status, 'active');
  assert.equal(record.applicants, 17);
  assert.deepEqual(record.qualifications, ['Business process analysis', 'Reporting']);
});
