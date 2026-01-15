/**
 * Prediction Form Component - Interactive trust predictor.
 */
import { store, setTrustPrediction } from '../../state/store.js';
import { api } from '../../api/client.js';
import { div, button, span, h3, select, option, label, input } from '../../utils/dom.js';

let predicting = false;

const createSpinner = () => div({ className: 'spinner spinner-small' });

const BRANCH_TYPES = [
  { value: '', label: '-- Select --' },
  { value: 'feature', label: 'Feature' },
  { value: 'fix', label: 'Fix / Bugfix' },
  { value: 'hotfix', label: 'Hotfix' },
  { value: 'refactor', label: 'Refactor' },
  { value: 'test', label: 'Test' },
  { value: 'docs', label: 'Documentation' },
  { value: 'chore', label: 'Chore' }
];

const TICKET_TYPES = [
  { value: '', label: '-- Select --' },
  { value: 'bug', label: 'Bug' },
  { value: 'feature', label: 'Feature' },
  { value: 'improvement', label: 'Improvement' },
  { value: 'task', label: 'Task' },
  { value: 'story', label: 'Story' },
  { value: 'epic', label: 'Epic' }
];

const getPredictionBadgeClass = (level) => {
  switch (level) {
    case 'high': return 'prediction-badge high';
    case 'medium': return 'prediction-badge medium';
    case 'low': return 'prediction-badge low';
    default: return 'prediction-badge';
  }
};

const getApproachLabel = (approach) => {
  switch (approach) {
    case 'autonomous': return 'Let Claude run autonomously';
    case 'light_monitoring': return 'Light monitoring recommended';
    case 'active_steering': return 'Plan for active steering';
    case 'detailed_breakdown': return 'Break into smaller tasks';
    default: return approach;
  }
};

const createPredictionResult = (prediction) => {
  if (!prediction) return null;

  const levelBadge = span(
    { className: getPredictionBadgeClass(prediction.predictedTrust) },
    prediction.predictedTrust.toUpperCase()
  );

  const confidence = span(
    { className: 'prediction-confidence' },
    `${Math.round(prediction.confidenceScore * 100)}% confidence`
  );

  const recommendation = div(
    { className: 'prediction-recommendation' },
    prediction.recommendation
  );

  const approach = div({ className: 'prediction-approach' }, [
    span({ className: 'prediction-approach-label' }, 'Suggested: '),
    span({ className: 'prediction-approach-value' }, getApproachLabel(prediction.suggestedApproach))
  ]);

  // Contributing factors
  const factors = prediction.factors && prediction.factors.length > 0
    ? div({ className: 'prediction-factors' }, [
        div({ className: 'prediction-factors-title' }, 'Contributing Factors:'),
        ...prediction.factors.map(factor =>
          div({ className: 'prediction-factor' }, [
            span({ className: 'prediction-factor-source' }, factor.source),
            span({ className: 'prediction-factor-insight' }, factor.insight),
            span(
              { className: `prediction-factor-score ${factor.trustLevel >= 0.7 ? 'high' : factor.trustLevel >= 0.4 ? 'medium' : 'low'}` },
              `${Math.round(factor.trustLevel * 100)}%`
            )
          ])
        )
      ])
    : null;

  return div({ className: 'prediction-result' }, [
    div({ className: 'prediction-result-header' }, [levelBadge, confidence]),
    recommendation,
    approach,
    factors
  ].filter(Boolean));
};

export const initPredictionForm = (container) => {
  // Form state
  let formData = {
    codebaseArea: '',
    ticketType: '',
    branchType: '',
    projectPath: ''
  };

  const handleInputChange = (field, value) => {
    formData[field] = value;
  };

  const handlePredict = async () => {
    if (predicting) return;

    // Check if at least one field is filled
    const hasInput = Object.values(formData).some(v => v.trim() !== '');
    if (!hasInput) {
      return;
    }

    predicting = true;
    render();

    try {
      // Build characteristics object from form
      const characteristics = {};
      if (formData.codebaseArea) characteristics.codebaseArea = formData.codebaseArea;
      if (formData.ticketType) characteristics.ticketType = formData.ticketType;
      if (formData.branchType) characteristics.branchType = formData.branchType;
      if (formData.projectPath) characteristics.projectPath = formData.projectPath;

      const response = await fetch('/api/trust/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characteristics })
      });

      if (!response.ok) {
        throw new Error('Failed to get prediction');
      }

      const prediction = await response.json();
      setTrustPrediction(prediction);
    } catch (err) {
      console.error('Prediction failed:', err);
    } finally {
      predicting = false;
      render();
    }
  };

  const handleClear = () => {
    formData = {
      codebaseArea: '',
      ticketType: '',
      branchType: '',
      projectPath: ''
    };
    setTrustPrediction(null);
    render();
  };

  const render = () => {
    const state = store.getState();
    const { trust } = state;

    // Get available areas from trust map for autocomplete hints
    const availableAreas = trust.map?.byArea?.map(a => a.category) || [];

    // Title
    const title = h3({ className: 'prediction-form-title' }, 'Trust Predictor');
    const subtitle = div(
      { className: 'prediction-form-subtitle' },
      'Enter task characteristics to predict trust level'
    );

    // Form fields
    const areaField = div({ className: 'prediction-field' }, [
      label({ for: 'pred-area' }, 'Codebase Area'),
      input({
        type: 'text',
        id: 'pred-area',
        placeholder: 'e.g., src/auth, tests/unit',
        value: formData.codebaseArea,
        onInput: (e) => handleInputChange('codebaseArea', e.target.value),
        list: 'area-suggestions'
      }),
      availableAreas.length > 0
        ? (() => {
            const datalist = document.createElement('datalist');
            datalist.id = 'area-suggestions';
            availableAreas.slice(0, 10).forEach(area => {
              const opt = document.createElement('option');
              opt.value = area;
              datalist.appendChild(opt);
            });
            return datalist;
          })()
        : null
    ].filter(Boolean));

    const ticketField = div({ className: 'prediction-field' }, [
      label({ for: 'pred-ticket' }, 'Ticket Type'),
      select(
        {
          id: 'pred-ticket',
          onChange: (e) => handleInputChange('ticketType', e.target.value)
        },
        TICKET_TYPES.map(t =>
          option({ value: t.value, selected: formData.ticketType === t.value ? 'selected' : null }, t.label)
        )
      )
    ]);

    const branchField = div({ className: 'prediction-field' }, [
      label({ for: 'pred-branch' }, 'Branch Type'),
      select(
        {
          id: 'pred-branch',
          onChange: (e) => handleInputChange('branchType', e.target.value)
        },
        BRANCH_TYPES.map(t =>
          option({ value: t.value, selected: formData.branchType === t.value ? 'selected' : null }, t.label)
        )
      )
    ]);

    const projectField = div({ className: 'prediction-field' }, [
      label({ for: 'pred-project' }, 'Project Path'),
      input({
        type: 'text',
        id: 'pred-project',
        placeholder: 'e.g., /home/user/myproject',
        value: formData.projectPath,
        onInput: (e) => handleInputChange('projectPath', e.target.value)
      })
    ]);

    const formGrid = div({ className: 'prediction-form-grid' }, [
      areaField,
      ticketField,
      branchField,
      projectField
    ]);

    // Action buttons
    const predictBtn = button(
      {
        className: 'btn btn-primary',
        onClick: handlePredict,
        disabled: predicting ? 'disabled' : null
      },
      predicting ? [createSpinner(), 'Predicting...'] : 'Predict Trust'
    );

    const clearBtn = button(
      {
        className: 'btn',
        onClick: handleClear
      },
      'Clear'
    );

    const actions = div({ className: 'prediction-form-actions' }, [predictBtn, clearBtn]);

    // Result display
    const result = createPredictionResult(trust.prediction);

    container.innerHTML = '';
    container.appendChild(title);
    container.appendChild(subtitle);
    container.appendChild(formGrid);
    container.appendChild(actions);
    if (result) {
      container.appendChild(result);
    }
  };

  // Subscribe to prediction changes
  store.subscribe((state, prevState) => {
    if (state.trust.prediction !== prevState.trust.prediction) {
      render();
    }
  });

  // Initial render
  render();
};
