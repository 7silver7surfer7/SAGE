describe('layout', () => {
  before(() => {
    cy.visit('/');
  });
  it('layout is available', () => {
    cy.dataCy('layout');
  });
  it('nav is a descendent of layout', () => {
    cy.dataCy('layout').find('[data-cy=footer]', { log: true });
  });
  it('footer is a descendent of layout', () => {
    cy.dataCy('layout').find('[data-cy=nav]', { log: true });
  });
});
