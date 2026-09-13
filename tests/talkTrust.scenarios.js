export const scenarios = [
  {
    name: 'ticket total alone does not satisfy required breakdown',
    facts: [
      { key: 'total', label: 'Total price', required: true, risk: 'high', status: 'confirmed', value: '€8' },
      { key: 'breakdown', label: 'Adult and child price breakdown', required: true, risk: 'high', status: 'missing', value: '' },
    ],
    accepted: false,
    unresolved: ['breakdown'],
  },
  {
    name: 'ticket breakdown heard but not verified still blocks completion',
    facts: [
      { key: 'total', label: 'Total price', required: true, risk: 'high', status: 'confirmed', value: '€8' },
      { key: 'breakdown', label: 'Adult and child price breakdown', required: true, risk: 'high', status: 'observed', value: '€5 + €3' },
    ],
    accepted: false,
    unresolved: ['breakdown'],
  },
  {
    name: 'confirmed total and component breakdown can complete',
    facts: [
      { key: 'total', label: 'Total price', required: true, risk: 'high', status: 'confirmed', value: '€8' },
      { key: 'breakdown', label: 'Adult and child price breakdown', required: true, risk: 'high', status: 'confirmed', value: 'Adult €5, child €3' },
    ],
    accepted: true,
  },
  {
    name: 'eighteen versus eighty ambiguity remains observed',
    facts: [
      { key: 'price', label: 'Price', required: true, risk: 'high', status: 'observed', value: '€18 or €80' },
    ],
    accepted: false,
    unresolved: ['price'],
  },
  {
    name: 'exact appointment time confirmed can complete',
    facts: [
      { key: 'appointment', label: 'Appointment time', required: true, risk: 'high', status: 'confirmed', value: '14 October at 10:30' },
    ],
    accepted: true,
  },
  {
    name: 'appointment time candidate cannot complete',
    facts: [
      { key: 'appointment', label: 'Appointment time', required: true, risk: 'high', status: 'observed', value: 'Around 10:30' },
    ],
    accepted: false,
    unresolved: ['appointment'],
  },
  {
    name: 'owner approval pending blocks otherwise complete task',
    facts: [
      { key: 'price', label: 'Price', required: true, risk: 'high', status: 'confirmed', value: '€42' },
    ],
    options: { ownerDecisionPending: true },
    accepted: false,
    issueCodes: ['owner_decision_pending'],
  },
  {
    name: 'optional missing information does not block',
    facts: [
      { key: 'core', label: 'Required result', required: true, status: 'confirmed', value: 'Confirmed' },
      { key: 'nice_to_know', label: 'Optional opening hours', required: false, status: 'missing', value: '' },
    ],
    accepted: true,
  },
  {
    name: 'explicitly unavailable fact with reason is a resolved outcome',
    facts: [
      { key: 'child_rule', label: 'Child ticket rule', required: true, status: 'unavailable', reason: 'Counter staff said they do not have that information.' },
    ],
    accepted: true,
  },
  {
    name: 'unavailable without any basis cannot be silently accepted',
    facts: [
      { key: 'child_rule', label: 'Child ticket rule', required: true, status: 'unavailable' },
    ],
    accepted: false,
    issueCodes: ['unavailable_without_basis'],
  },
  {
    name: 'confirmed fact with blank value is not trustworthy',
    facts: [
      { key: 'reference', label: 'Reference number', required: true, risk: 'high', status: 'confirmed', value: '' },
    ],
    accepted: false,
    issueCodes: ['confirmed_without_value'],
  },
  {
    name: 'reference number with exact value can complete',
    facts: [
      { key: 'reference', label: 'Reference number', required: true, risk: 'high', status: 'confirmed', value: 'AB-48291' },
    ],
    accepted: true,
  },
  {
    name: 'contradictory price must regress to observed and block',
    facts: [
      { key: 'price', label: 'Price', required: true, risk: 'high', status: 'observed', value: '€24 first, then €42' },
    ],
    accepted: false,
    unresolved: ['price'],
  },
  {
    name: 'background speech candidate cannot become a fact',
    facts: [
      { key: 'platform', label: 'Platform number', required: true, risk: 'high', status: 'observed', value: 'Possibly platform 8' },
    ],
    accepted: false,
    unresolved: ['platform'],
  },
  {
    name: 'incomplete address remains unresolved',
    facts: [
      { key: 'address', label: 'Office address', required: true, risk: 'high', status: 'observed', value: 'Königstraße, number unclear' },
    ],
    accepted: false,
    unresolved: ['address'],
  },
  {
    name: 'exact address can complete',
    facts: [
      { key: 'address', label: 'Office address', required: true, risk: 'high', status: 'confirmed', value: 'Königstraße 14, Stuttgart' },
    ],
    accepted: true,
  },
  {
    name: 'dynamic newly discovered required condition blocks until resolved',
    facts: [
      { key: 'price', label: 'Price', required: true, status: 'confirmed', value: '€12' },
      { key: 'id_requirement', label: 'ID requirement', required: true, status: 'missing', value: '' },
    ],
    accepted: false,
    unresolved: ['id_requirement'],
  },
  {
    name: 'explicit no-ID rule can be confirmed',
    facts: [
      { key: 'id_requirement', label: 'ID requirement', required: true, status: 'confirmed', value: 'No ID required for the child ticket' },
    ],
    accepted: true,
  },
  {
    name: 'uncertain quantity blocks order completion',
    facts: [
      { key: 'quantity', label: 'Quantity', required: true, risk: 'high', status: 'observed', value: 'Two or three items' },
    ],
    accepted: false,
    unresolved: ['quantity'],
  },
  {
    name: 'confirmed quantity permits completion',
    facts: [
      { key: 'quantity', label: 'Quantity', required: true, risk: 'high', status: 'confirmed', value: '2 items' },
    ],
    accepted: true,
  },
  {
    name: 'payment decision remains owner-controlled',
    facts: [
      { key: 'price', label: 'Price', required: true, risk: 'high', status: 'confirmed', value: '€65' },
      { key: 'terms', label: 'Cancellation terms', required: true, status: 'confirmed', value: 'Non-refundable' },
    ],
    options: { ownerDecisionPending: true },
    accepted: false,
    issueCodes: ['owner_decision_pending'],
  },
  {
    name: 'all required facts unavailable with explicit evidence can close honestly',
    facts: [
      { key: 'fee_breakdown', label: 'Fee breakdown', required: true, status: 'unavailable', evidence: 'Clerk explicitly said only the total is available.' },
    ],
    accepted: true,
  },
  {
    name: 'no required facts can complete when no owner decision is pending',
    facts: [],
    accepted: true,
  },
  {
    name: 'simple missing required fact blocks completion',
    facts: [
      { key: 'deadline', label: 'Deadline', required: true, status: 'missing', value: '' },
    ],
    accepted: false,
    unresolved: ['deadline'],
  },
]
