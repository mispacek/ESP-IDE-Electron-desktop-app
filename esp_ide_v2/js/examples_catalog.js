/*
  Official ESP IDE examples shown in Project > Examples.

  File layout:
    examples/cs/<file>  Czech projects
    examples/en/<file>  English projects (also used by all other languages)

  To add an example, store the same relative file path in each available
  language folder, add its translation key to i18n/*.json and list it here.
*/
(function () {
  'use strict';

  window.ESPIDE_EXAMPLES_CATALOG = [
    {
      labelKey: 'examples.categories.basic',
      items: [
        { labelKey: 'examples.items.basic01', file: 'Basic/01.blk' },
        { labelKey: 'examples.items.basic02', file: 'Basic/02.blk' },
        { labelKey: 'examples.items.basic03', file: 'Basic/03.blk' },
        { labelKey: 'examples.items.basic04', file: 'Basic/04.blk' },
        { labelKey: 'examples.items.basic05', file: 'Basic/05.blk' }
      ]
    },
    {
      labelKey: 'examples.categories.sensor',
      items: [
        { labelKey: 'examples.items.sensor01', file: 'Sensor/01.blk' },
        { labelKey: 'examples.items.sensor02', file: 'Sensor/02.blk' },
        { labelKey: 'examples.items.sensor03', file: 'Sensor/03.blk' },
        { labelKey: 'examples.items.sensor04', file: 'Sensor/04.blk' },
        { labelKey: 'examples.items.sensor05', file: 'Sensor/05.blk' }
      ]
    },
    {
      labelKey: 'examples.categories.display',
      items: [
        { labelKey: 'examples.items.display01', file: 'Display/01.blk' },
        { labelKey: 'examples.items.display02', file: 'Display/02.blk' }
      ]
    }
  ];
})();
