import { useEffect, useRef } from 'react';
import { FlowingMascot } from '../mascots/FlowingMascot';
import { throttleMascot } from '../mascots/throttle';
import { Lede, SplitTitle } from '../parts';

export function Security() {
  const mascotRef = useRef<HTMLDivElement>(null);
  useEffect(() => throttleMascot(mascotRef.current, 'eYMl'), []);

  return (
    <section className="security" id="seguranca" aria-labelledby="securityTitle" data-pause>
      <div className="security-grid">
        <div className="security-mascot bob" aria-hidden="true">
          <div className="mascot m-flowing" ref={mascotRef}>
            <FlowingMascot />
          </div>
        </div>
        <div>
          <SplitTitle id="securityTitle" accent="fácil." text="Setup fácil." />
          <Lede>O controle fica com quem administra. Cada pessoa usa a ferramenta apenas nos repositórios liberados.</Lede>
          <dl className="security-list stagger">
            <div>
              <dt>Liberado por repositório</dt>
              <dd>
                A extensão lê o remote do <code>.git</code> e só funciona se aquele repositório estiver num projeto seu.
              </dd>
            </div>
            <div>
              <dt>Suspender é imediato</dt>
              <dd>Empresa suspensa ou pessoa removida: a extensão trava sozinha em até um minuto.</dd>
            </div>
            <div>
              <dt>Sua chave de IA fica com você</dt>
              <dd>Guardada no armazenamento seguro do VS Code. Sem chave, o seu código não sai da máquina.</dd>
            </div>
            <div>
              <dt>Credenciais protegidas</dt>
              <dd>Senhas com scrypt e tokens dos VS Codes conectados guardados só como hash.</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
