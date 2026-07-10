export function Subheader({ children }: { children: React.ReactNode }) {
  return <h2 className='submissions-page__guidelines-header'>{children}</h2>;
}

export function Text({ children }: { children: React.ReactNode }) {
  return <p className='submissions-page__guidelines-text'>{children}</p>;
}

export function List({ children }: { children: React.ReactNode }) {
  return <ul className='submissions-page__guidelines-list'>{children}</ul>;
}

export function Bullet({ children }: { children: React.ReactNode }) {
  return <li className='submissions-page__guidelines-list-item'>{children}</li>;
}

export function Group({ children }: { children?: React.ReactNode }) {
  return <div className='submissions-page__guidelines-group'>{children}</div>;
}
