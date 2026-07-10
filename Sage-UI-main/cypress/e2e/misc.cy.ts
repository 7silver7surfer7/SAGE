describe('extras', () => {
  before(() => {
    cy.visit('/');
  });

	//needed for UI app utilities i.e. modals & tabs etc 
  it('headless ui portal is available', () => {
    cy.get('#headlessui-portal-root');
  });

	//needed for UI app notification messages
  it('toast container is available', () => {
    cy.get('.Toastify');
    cy.get('.Toastify__toast-container');
  });
});
