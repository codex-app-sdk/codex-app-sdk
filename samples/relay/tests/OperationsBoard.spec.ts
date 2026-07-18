import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import OperationsBoard from '../src/renderer/components/OperationsBoard.vue';
import { relayOperationsSnapshot } from './fakes';

describe('OperationsBoard', () => {
  it('renders the selected exception, route, KPIs, and actionable queue', async () => {
    const snapshot = relayOperationsSnapshot();
    const wrapper = mount(OperationsBoard, {
      props: {
        accountLabel: 'dispatcher@example.com',
        selectedShipment: snapshot.shipments[0]!,
        snapshot,
      },
    });

    expect(wrapper.text()).toContain('On time86%');
    expect(wrapper.text()).toContain('SHP-4827');
    expect(wrapper.text()).toContain('Chicago → Dallas');
    expect(wrapper.text()).toContain('Customs hold');
    expect(wrapper.text()).toContain('Issue detail');
    expect(wrapper.findAll('.exception-row')).toHaveLength(3);
    expect(wrapper.get('.shipment-route__heading').text()).toContain('2 of 4 complete');
    expect(wrapper.findAll('.shipment-timeline__status').map((status) => status.text()))
      .toStrictEqual(['Completed', 'Completed', 'Active issue', 'Scheduled']);
    expect(wrapper.findAll('.shipment-timeline__marker').map((marker) => marker.text()))
      .toStrictEqual(['✓', '✓', '!', '4']);
    expect(wrapper.get('.shipment-timeline__exception').text()).toContain(
      'The shipment was selected for a customs inspection at the Chicago terminal.',
    );
    expect(wrapper.get('.shipment-timeline__exception').text()).toContain('Detected 08:42');
    expect(wrapper.get('.shipment-route__impact').text()).toContain('Northstar Medical');
    expect(wrapper.get('.shipment-route__impact').text()).toContain('$84,000');
    expect(wrapper.get('.shipment-route__impact').text()).toContain('Commitment17:00');
    expect(Array.from(wrapper.get('.operations-board__workspace').element.children)).toStrictEqual([
      wrapper.get('.exception-queue').element,
      wrapper.get('.shipment-focus').element,
    ]);

    await wrapper.findAll('.exception-row')[1]!.trigger('click');
    expect(wrapper.emitted('select')).toStrictEqual([['SHP-7152']]);

    await wrapper.findAll('.shipment-actions button')[1]!.trigger('click');
    expect(wrapper.emitted('action')).toStrictEqual([[
      'compare-recovery',
      snapshot.shipments[0],
    ]]);
  });

  it('disables every contextual action while a prompt is being submitted', () => {
    const snapshot = relayOperationsSnapshot();
    const wrapper = mount(OperationsBoard, {
      props: {
        actionPending: true,
        selectedShipment: snapshot.shipments[0]!,
        snapshot,
      },
    });

    expect(wrapper.findAll('.shipment-actions button').map((button) => button.attributes('disabled')))
      .toStrictEqual(['', '', '']);
  });
});
