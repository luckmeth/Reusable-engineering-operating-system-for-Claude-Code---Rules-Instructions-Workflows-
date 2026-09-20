# Machine learning

## What it does, and what it deliberately does not

CECC learns which findings **you** act on, and uses that to order your list.

It does **not** detect anything. Detection stays deterministic: a rule matches a
pattern, points at an exact line, and states why. Replacing that with a model
would trade an explanation for a probability — the same false confidence this
product exists to prevent.

| | Handled by |
|---|---|
| Is this a problem? | Deterministic rules with evidence |
| How serious is it? | Rule severity, fixed |
| What should I read first? | **The learned model** |

The model cannot create a finding, close one, change a severity, or hide
anything. Its only output is an ordering.

## Why ranking is the right problem for ML

A developer with 20 open findings does not need a model to tell them what a SQL
injection is. They need to know which three to look at before lunch — and that
depends on their project, their risk tolerance and their history, which is
exactly the kind of thing no fixed rule can encode and a small model can.

## Severity is a hard boundary

The model reorders **within** a severity band and is never allowed to move a
finding across one. A critical problem cannot be buried beneath a minor one
because the developer happens to dismiss that check often.

Severity is a deterministic statement about consequence. Personal history is
useful for ordering equals, not for overruling consequence.

## Where the training data comes from

From decisions you already make:

- **Resolve a finding** → label 1 (this mattered)
- **Dismiss a finding** → label 0 (this was noise)

There is no separate labelling chore. Open findings are never used as negatives
— an undecided finding is not a dismissal, and treating it as one would teach
the model that everything is noise.

## Models

Two, both trained locally on every run, with the better one chosen by held-out
AUC.

**Logistic regression** — mini-batch gradient descent, L2 regularization,
feature standardization, class weighting for imbalance, early stopping on a
validation split. Exposes per-feature weights, which is why explanations come
from this model even when naive Bayes scores better.

**Bernoulli naive Bayes** — Laplace-smoothed, computed in log space. Needs far
less data to produce something sensible, and disagreement between the two is a
cheap signal that the logistic model is fitting noise.

Neither is a compromise. With tens to low hundreds of examples, a high-capacity
model memorizes rather than generalizes.

## Features

Around 40, all named and human-readable: severity, confidence, verification
state, security layer, detection method, file kind (test / config / migration /
vendor), file and evidence counts, recurrence, and — usually the strongest
signal — how you have treated that rule before.

Rule identity is hashed into 16 buckets rather than one-hot encoded, so adding a
new rule needs no retraining and no schema change.

No text embeddings. Every feature must be explainable in a sentence, because a
ranking nobody can interrogate is worse than no ranking.

## Refusing to guess

Training is **refused** below 30 examples with at least 8 of each outcome. Below
that, any model is fitting a handful of clicks, and the interface says "still
learning, N more needed" rather than showing a confident-looking order.

Ranking is **declined** when held-out AUC is below 0.60, with the reason stated
on screen. A model no better than chance would make the list look intelligently
ordered while being close to random.

## Honest metrics

The model card shows, always on held-out data:

- **AUC** — ranking quality. The most honest single number, and insensitive to
  the class imbalance that makes accuracy flattering.
- **Accuracy, next to the majority-class baseline** — so a model that scores 85%
  by predicting "dismiss" for everything is visibly not learning.
- **Precision and recall** — wasted looks versus missed problems.
- **Confusion matrix**, with the costly quadrant called out: findings the model
  pushed down that you turned out to care about.
- **Sample count** — how much data any of this rests on.
- **Learned weights** — what it actually concluded.

## Explanations

Every ranked finding carries a sentence naming the signals that moved it:

> Prioritised because of how severe it is and you rarely dismissing this check,
> lowered by it being in a test file.

Direction matters and was a real bug: a negative weight on "you usually dismiss
this" multiplied by a below-average value yields a *positive* contribution.
Reporting the feature name alone rendered that as "prioritised because you
usually dismiss this" — the opposite of the model's actual conclusion.
Explanations now carry which side of average the finding sits on.

## Datasets

Export produces one JSON object per decision, carrying only structural
attributes: which check fired, severity, layer, detection method, confidence,
file *shape* (`src/ts`, `tests/ts`), occurrence and evidence counts, and the
label.

No code, no file paths, no evidence text, no titles. A dataset is the one
artefact here designed to leave the machine, so it carries nothing redaction
would have caught.

Import validates rows individually — one malformed line does not discard a
usable file — and rebuilds each row through the same feature extraction as
observed data, so the two cannot drift.

## Everything is local

No external service, no API key, no network call. Training and inference are
arithmetic over a few dozen numbers, fast enough to run on every page load. The
model is a JSON file in `.cecc/models/`, and deleting it returns the interface
to severity ordering.

## Tests

28 tests in `packages/ml/test/`, including:

- the model recovers a known pattern (AUC > 0.9 on separable data)
- loss decreases during training
- training is refused below threshold, and when one outcome is missing
- metrics are correct against hand-computed values, including tied and inverted
  rankings
- the majority-class baseline is reported
- training is reproducible — same data, same weights
- severity bands are never crossed
- ranking is declined when the model cannot beat chance
- explanations distinguish above-average from below-average feature values
- no NaN on extreme inputs, and models survive a JSON round trip
